import AppKit
import ApplicationServices
import ScreenCaptureKit
import CryptoKit

struct Failure: Error { let message: String }
func fail(_ message: String) throws -> Never { throw Failure(message: message) }
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success ? result : nil
}
func string(_ element: AXUIElement, _ name: String) -> String {
    (attribute(element, name) as? String ?? "").prefix(2000).description
}
func fingerprint(_ element: AXUIElement) -> String {
    let fields = ["AXRole", "AXSubrole", "AXTitle", "AXDescription", "AXIdentifier"].map { string(element, $0) }
    return SHA256.hash(data: try! JSONSerialization.data(withJSONObject: fields)).prefix(8).map { String(format: "%02x", $0) }.joined()
}
func children(_ element: AXUIElement) -> [AXUIElement] { attribute(element, "AXChildren") as? [AXUIElement] ?? [] }
func actions(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    AXUIElementCopyActionNames(element, &names)
    return names as? [String] ?? []
}
func check(_ error: AXError) throws {
    if error != .success { try fail("Accessibility error \(error.rawValue). Inspect again; the app may not support this action in the background.") }
}
func target(_ args: [String: Any]) throws -> (NSRunningApplication, AXUIElement) {
    guard let pid = args["pid"] as? Int, pid > 0, let app = NSRunningApplication(processIdentifier: pid_t(pid)), !app.isTerminated else { try fail("Target application is no longer running; list apps again.") }
    guard let bundle = args["bundle_id"] as? String, app.bundleIdentifier == bundle else { try fail("Target bundle_id does not match pid; list apps again.") }
    let element = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(element, 2)
    return (app, element)
}
func element(_ args: [String: Any], _ root: AXUIElement) throws -> AXUIElement {
    guard let id = args["element_id"] as? String else { try fail("Inspect the target app first and supply element_id.") }
    let parts = id.split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 2 else { try fail("Invalid element_id") }
    var node = root
    if !parts[0].isEmpty {
        for piece in parts[0].split(separator: ".") {
            guard let index = Int(piece), index >= 0, index < 500 else { try fail("Invalid element path") }
            let list = children(node)
            guard index < list.count else { try fail("Element changed; inspect again.") }
            node = list[index]
        }
    }
    guard fingerprint(node) == parts[1] else { try fail("Element changed; inspect again.") }
    if string(node, "AXSubrole") == "AXSecureTextField" { try fail("Secure fields are unavailable.") }
    return node
}
// Breadth-first traversal keeps search/input controls visible even when a chat
// exposes hundreds of messages before the controls in AXChildren.
func tree(_ root: AXUIElement, _ rootPath: String = "") -> [String: Any] {
    var rows = [[String: Any]]()
    var pending: [(AXUIElement, String, Int)] = [(root, rootPath, 0)]
    var cursor = 0
    var clipped = false
    while cursor < pending.count && rows.count < 400 {
        let (node, path, depth) = pending[cursor]
        cursor += 1
        let secure = string(node, "AXSubrole") == "AXSecureTextField"
        var row: [String: Any] = ["element_id": path + ":" + fingerprint(node), "role": string(node, "AXRole"), "title": string(node, "AXTitle"), "description": string(node, "AXDescription"), "actions": actions(node)]
        if !secure { row["value"] = string(node, "AXValue") }
        for name in ["AXValue", "AXFocused"] {
            var writable = DarwinBoolean(false)
            AXUIElementIsAttributeSettable(node, name as CFString, &writable)
            row[name == "AXValue" ? "value_settable" : "focus_settable"] = writable.boolValue && !secure
        }
        if let focused = attribute(node, "AXFocused") as? Bool { row["focused"] = focused }
        rows.append(row)
        // At most 500 children per node and 16 levels; expose truncation so the
        // caller can inspect a specific subtree without activating its window.
        let list = secure ? [] : children(node)
        row["child_count"] = list.count
        rows[rows.count - 1] = row
        clipped = clipped || list.count > 500 || (depth >= 15 && !list.isEmpty)
        if depth < 15 {
            for (index, child) in list.prefix(500).enumerated() {
                pending.append((child, path.isEmpty ? String(index) : path + "." + String(index), depth + 1))
            }
        }
    }
    return ["elements": rows, "limit": 400, "truncated": cursor < pending.count || clipped]
}

@available(macOS 14.0, *)
func execute(_ args: [String: Any]) async throws -> [String: Any] {
    let operation = args["operation"] as? String ?? "status"
    if operation == "status" {
        return ["accessibility": AXIsProcessTrusted(), "screen_recording": CGPreflightScreenCaptureAccess(), "background_input": "AX actions and process-targeted events; app support varies"]
    }
    if operation == "apps" {
        return ["apps": NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map { ["pid": $0.processIdentifier, "bundle_id": $0.bundleIdentifier ?? "", "name": $0.localizedName ?? "", "frontmost": $0.isActive] as [String: Any] }]
    }
    let (app, root) = try target(args)
    if operation == "windows" || operation == "screenshot" {
        guard CGPreflightScreenCaptureAccess() else { try fail("Enable Screen Recording for AI Router in local Mac settings, then restart the app.") }
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
        let windows = content.windows.filter { $0.owningApplication?.processID == app.processIdentifier && $0.windowLayer == 0 }
        if operation == "windows" {
            return ["windows": windows.map { ["window_id": $0.windowID, "title": $0.title ?? "", "width": $0.frame.width, "height": $0.frame.height, "x": $0.frame.minX, "y": $0.frame.minY, "on_screen": $0.isOnScreen] as [String: Any] }]
        }
        guard let id = args["window_id"] as? Int, let window = windows.first(where: { Int($0.windowID) == id }) else { try fail("Window no longer belongs to target app; list windows again.") }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        let scale = min(1.0, 1440.0 / max(window.frame.width, window.frame.height, 1))
        config.width = max(1, Int(window.frame.width * scale))
        config.height = max(1, Int(window.frame.height * scale))
        config.showsCursor = false
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.7]), data.count <= 2_000_000 else { try fail("Screenshot too large") }
        return ["image": data.base64EncodedString(), "mimeType": "image/jpeg", "width": image.width, "height": image.height, "window_id": id]
    }
    guard AXIsProcessTrusted() else { try fail("Enable Accessibility for AI Router in local Mac settings, then restart the app.") }
    if operation == "inspect" {
        if let id = args["element_id"] as? String {
            return tree(try element(args, root), String(id.split(separator: ":", omittingEmptySubsequences: false)[0]))
        }
        return tree(root)
    }
    if operation == "press" || operation == "set_value" || operation == "action" || operation == "focus" {
        let node = try element(args, root)
        if operation == "focus" {
            // Focus an element inside the target app, never AXRaise or activate.
            try check(AXUIElementSetAttributeValue(node, "AXFocused" as CFString, kCFBooleanTrue))
        } else if operation == "set_value" {
            guard let value = args["text"] as? String, value.utf16.count <= 10000 else { try fail("Invalid text") }
            try check(AXUIElementSetAttributeValue(node, "AXValue" as CFString, value as CFString))
        } else {
            let name = operation == "press" ? "AXPress" : args["action"] as? String ?? ""
            guard ["AXPress", "AXConfirm", "AXCancel", "AXIncrement", "AXDecrement", "AXShowMenu", "AXPick"].contains(name), actions(node).contains(name) else { try fail("Unsupported AX action. Inspect available actions.") }
            try check(AXUIElementPerformAction(node, name as CFString))
        }
        return ["ok": true, "verify": "Inspect or screenshot to verify the result."]
    }
    // Never post to the global event stream, activate an app, or move the real cursor.
    guard !app.isActive else { try fail("Target app is in the foreground. Background event input is paused while you use it. AX actions remain available.") }
    let source = CGEventSource(stateID: .privateState)
    func post(_ event: CGEvent?) throws {
        guard let event else { try fail("Could not create event") }
        event.postToPid(app.processIdentifier)
    }
    if operation == "key" || operation == "type_text" {
        if operation == "type_text" {
            guard let text = args["text"] as? String, text.utf16.count <= 10000 else { try fail("Invalid text") }
            let units = Array(text.utf16)
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true), let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else { try fail("Cannot create keyboard event") }
            units.withUnsafeBufferPointer { buffer in
                down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress)
                up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress)
            }
            try post(down); try post(up)
        } else {
            guard let code = args["key_code"] as? Int, (0...127).contains(code) else { try fail("Invalid macOS virtual key_code") }
            var flags: CGEventFlags = []
            for modifier in args["modifiers"] as? [String] ?? [] {
                switch modifier { case "command": flags.insert(.maskCommand); case "shift": flags.insert(.maskShift); case "option": flags.insert(.maskAlternate); case "control": flags.insert(.maskControl); default: try fail("Unknown modifier") }
            }
            for down in [true, false] {
                let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(code), keyDown: down)
                event?.flags = flags
                try post(event)
            }
        }
    } else if ["click", "scroll", "drag"].contains(operation) {
        guard let windowID = args["window_id"] as? Int,
              let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]],
              let window = windows.first(where: { ($0[kCGWindowNumber as String] as? Int) == windowID && ($0[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier) }),
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
              let x = args["x"] as? Double, let y = args["y"] as? Double, x >= 0, y >= 0, x < rect.width, y < rect.height else { try fail("Supply a valid target window_id and window-relative x,y in points, from windows (not scaled screenshot pixels).") }
        let point = CGPoint(x: rect.minX + x, y: rect.minY + y)
        func mouse(_ type: CGEventType, _ at: CGPoint) throws {
            let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: at, mouseButton: .left)
            event?.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(windowID))
            event?.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(windowID))
            try post(event)
        }
        if operation == "scroll" {
            guard let dy = args["delta_y"] as? Int, abs(dy) <= 10000 else { try fail("Invalid delta_y") }
            let event = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 1, wheel1: Int32(dy), wheel2: 0, wheel3: 0)
            event?.location = point
            try post(event)
        } else if operation == "drag" {
            guard let endX = args["end_x"] as? Double, let endY = args["end_y"] as? Double, endX >= 0, endY >= 0, endX < rect.width, endY < rect.height else { try fail("Invalid drag endpoint") }
            try mouse(.leftMouseDown, point)
            defer { try? mouse(.leftMouseUp, CGPoint(x: rect.minX + endX, y: rect.minY + endY)) }
            for step in 1...10 {
                try mouse(.leftMouseDragged, CGPoint(x: point.x + (endX - x) * Double(step) / 10, y: point.y + (endY - y) * Double(step) / 10))
            }
        } else {
            try mouse(.leftMouseDown, point); try mouse(.leftMouseUp, point)
        }
    } else { try fail("Unknown operation") }
    return ["ok": true, "experimental": true, "verify": "Process-targeted input is app-dependent. Inspect or screenshot to verify; do not assume delivery means success."]
}

@main struct ComputerUse {
    static func main() async {
        // ScreenCaptureKit requires a WindowServer connection even for a CLI
        // helper. Initialize AppKit without allowing this helper to activate.
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        do {
            if CommandLine.arguments.contains("--request-permissions") || CommandLine.arguments.contains("--request-accessibility") {
                let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
                _ = AXIsProcessTrustedWithOptions(options)
            }
            if CommandLine.arguments.contains("--request-permissions") || CommandLine.arguments.contains("--request-screen-recording") {
                _ = CGRequestScreenCaptureAccess()
            }
            let data = FileHandle.standardInput.readDataToEndOfFile()
            let args = data.isEmpty ? ["operation": "status"] : try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            guard #available(macOS 14.0, *) else { try fail("Computer use requires macOS 14 or later.") }
            let result = try await execute(args)
            FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
        } catch {
            let message = (error as? Failure)?.message ?? error.localizedDescription
            let data = try! JSONSerialization.data(withJSONObject: ["error": message])
            FileHandle.standardOutput.write(data)
            exit(1)
        }
    }
}
