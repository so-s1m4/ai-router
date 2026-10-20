import AppKit
final class Controller: NSObject {
    let field = NSTextField(string: "initial")
    let result = NSTextField(labelWithString: "waiting")
    @objc func press(_ sender: Any?) { result.stringValue = "pressed:" + field.stringValue }
    func start() {
        let window = NSWindow(contentRect: NSRect(x: 80, y: 80, width: 400, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "AI Router Background Test"
        let root = window.contentView!
        // A large earlier subtree must not consume the entire inspect budget.
        let history = NSView(frame: .zero)
        history.setAccessibilityElement(true)
        history.setAccessibilityRole(.group)
        for i in 0..<450 { history.addSubview(NSTextField(labelWithString: "History \(i)")) }
        root.addSubview(history)
        field.frame = NSRect(x: 20, y: 110, width: 250, height: 24)
        field.setAccessibilityIdentifier("background-field")
        root.addSubview(field)
        let button = NSButton(title: "Verify background", target: self, action: #selector(press))
        button.frame = NSRect(x: 20, y: 60, width: 200, height: 30)
        root.addSubview(button)
        result.frame = NSRect(x: 20, y: 20, width: 350, height: 24)
        root.addSubview(result)
        window.isReleasedWhenClosed = false
        window.orderBack(nil)
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let controller = Controller()
controller.start()
app.run()
