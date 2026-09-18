// 얼굴 상자와 두 눈의 위치를 JSON 으로 낸다 — macOS Vision(로컬, 네트워크 없음).
//   swift scripts/face-metrics.swift <사진>
// 좌표는 픽셀, 원점은 **왼쪽 위**(Vision 의 왼쪽 아래 정규 좌표를 뒤집는다).
// Haar 캐스케이드는 상자에 머리카락·이마가 섞여 사람마다 들쭉날쭉했다 — 얼굴 크기를
// 맞추는 기준으로 쓰기엔 편차가 컸다. Vision 의 상자는 얼굴(이마~턱, 볼~볼)에 붙는다.
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 2, let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("cannot read image\n".data(using: .utf8)!)
  exit(2)
}
let W = CGFloat(cg.width), H = CGFloat(cg.height)
let req = VNDetectFaceLandmarksRequest()
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
guard let faces = req.results, !faces.isEmpty else {
  FileHandle.standardError.write("no face\n".data(using: .utf8)!)
  exit(3)
}
let f = faces.max(by: { $0.boundingBox.width < $1.boundingBox.width })!
let b = f.boundingBox
func px(_ p: CGPoint) -> [String: Double] {  // 얼굴 상자 안의 정규 좌표 → 픽셀(왼쪽 위 원점)
  let x = (b.origin.x + p.x * b.width) * W
  let y = (1 - (b.origin.y + p.y * b.height)) * H
  return ["x": Double(x), "y": Double(y)]
}
func center(_ r: VNFaceLandmarkRegion2D?) -> [String: Double]? {
  guard let r = r, r.pointCount > 0 else { return nil }
  let pts = r.normalizedPoints
  let mx = pts.map { $0.x }.reduce(0, +) / CGFloat(pts.count)
  let my = pts.map { $0.y }.reduce(0, +) / CGFloat(pts.count)
  return px(CGPoint(x: mx, y: my))
}
var out: [String: Any] = [
  "w": Double(W), "h": Double(H),
  "face": ["x": Double(b.origin.x * W), "y": Double((1 - b.origin.y - b.height) * H),
           "w": Double(b.width * W), "h": Double(b.height * H)],
]
if let l = center(f.landmarks?.leftEye) { out["leftEye"] = l }
if let r = center(f.landmarks?.rightEye) { out["rightEye"] = r }
let data = try JSONSerialization.data(withJSONObject: out)
print(String(data: data, encoding: .utf8)!)
