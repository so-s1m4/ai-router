import Foundation
import Speech
import AVFoundation

// This helper is launched only after the user presses the microphone button.
func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) {
        print(text)
        fflush(stdout)
    }
}
let engine = AVAudioEngine()
let request = SFSpeechAudioBufferRecognitionRequest()
let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ru-RU"))
var task: SFSpeechRecognitionTask?
var ending = false
var finished = false
var tapped = false
func finish(_ error: String? = nil) {
    if finished { return }
    finished = true
    if engine.isRunning { engine.stop() }
    if tapped { engine.inputNode.removeTap(onBus: 0) }
    request.endAudio()
    task?.cancel()
    if let error = error { emit(["type": "error", "message": error]) }
    emit(["type": "end"])
    exit(error == nil ? 0 : 1)
}
func stop() {
    if ending { return }
    ending = true
    if engine.isRunning { engine.stop() }
    request.endAudio()
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { finish() }
}
signal(SIGTERM, SIG_IGN)
let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
termination.setEventHandler { stop() }
termination.resume()
func begin() {
    if ending { finish(); return }
    guard let recognizer = recognizer, recognizer.isAvailable else {
        finish("Russian speech recognition is unavailable. Check your internet connection and macOS dictation settings."); return
    }
    request.shouldReportPartialResults = true
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    if format.sampleRate == 0 || format.channelCount == 0 { finish("No microphone found."); return }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
    tapped = true
    task = recognizer.recognitionTask(with: request) { result, error in
        DispatchQueue.main.async {
            if let result = result { emit(["type": "result", "text": result.bestTranscription.formattedString, "final": result.isFinal]) }
            if result?.isFinal == true { finish(); return }
            if let error = error { finish(ending ? nil : "Unable to recognize speech: \(error.localizedDescription)") }
        }
    }
    do { engine.prepare(); try engine.start(); emit(["type": "ready"]) }
    catch { finish("Unable to start the microphone: \(error.localizedDescription)") }
    DispatchQueue.main.asyncAfter(deadline: .now() + 55) { stop() }
}
SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async {
        if ending { finish(); return }
        guard status == .authorized else { finish("Allow AI Router in System Settings → Privacy & Security → Speech Recognition."); return }
        AVCaptureDevice.requestAccess(for: .audio) { allowed in
            DispatchQueue.main.async {
                if allowed { begin() }
                else { finish("Allow AI Router in System Settings → Privacy & Security → Microphone.") }
            }
        }
    }
}
dispatchMain()
