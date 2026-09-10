import AppKit
import CoreGraphics
let values = CommandLine.arguments.dropFirst().compactMap(Double.init)
guard values.count == 4 else { exit(1) }
let start = CGPoint(x: values[0], y: values[1])
let end = CGPoint(x: values[2], y: values[3])
let source = CGEventSource(stateID: .hidSystemState)
func post(_ type: CGEventType, _ point: CGPoint) {
    CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}
post(.mouseMoved, start)
Thread.sleep(forTimeInterval: 0.2)
post(.leftMouseDown, start)
Thread.sleep(forTimeInterval: 0.25)
for step in 1...50 {
    let fraction = Double(step) / 50
    post(.leftMouseDragged, CGPoint(x: start.x + (end.x-start.x)*fraction, y: start.y+(end.y-start.y)*fraction))
    Thread.sleep(forTimeInterval: 0.025)
}
Thread.sleep(forTimeInterval: 0.5)
post(.leftMouseUp, end)
