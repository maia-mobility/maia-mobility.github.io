// 사진에서 사람 영역의 마스크(흰색 = 사람)를 PNG 로 낸다 — macOS Vision, 로컬.
//   swift scripts/person-mask.swift <사진> <마스크.png>
// 증명사진의 배경색이 사람마다 달라(회색·라벤더·흰색) 명단에 나란히 놓으면 네 장의
// 배경이 네 색이었다. 사람만 떼어 같은 배경 위에 얹으려고 쓴다(fit-portrait.py --bg).
import Foundation
import Vision
import AppKit
import CoreImage

let args = CommandLine.arguments
guard args.count >= 3, let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("cannot read image\n".data(using: .utf8)!)
  exit(2)
}
let req = VNGeneratePersonSegmentationRequest()
req.qualityLevel = .accurate
req.outputPixelFormat = kCVPixelFormatType_OneComponent8
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
guard let buf = req.results?.first?.pixelBuffer else {
  FileHandle.standardError.write("no mask\n".data(using: .utf8)!)
  exit(3)
}
let ci = CIImage(cvPixelBuffer: buf)
let ctx = CIContext()
guard let out = ctx.createCGImage(ci, from: ci.extent) else { exit(4) }
let rep = NSBitmapImageRep(cgImage: out)
guard let png = rep.representation(using: .png, properties: [:]) else { exit(5) }
try png.write(to: URL(fileURLWithPath: args[2]))
print("\(out.width)x\(out.height)")
