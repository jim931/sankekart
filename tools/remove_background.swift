import CoreImage
import Foundation
import Vision

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
  fputs("Usage: swift remove_background.swift input output\n", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: arguments[1])
let outputURL = URL(fileURLWithPath: arguments[2])

guard let inputImage = CIImage(contentsOf: inputURL) else {
  fputs("Could not read input image\n", stderr)
  exit(1)
}

let handler = VNImageRequestHandler(ciImage: inputImage, options: [:])
let request = VNGenerateForegroundInstanceMaskRequest()

do {
  try handler.perform([request])
  guard let observation = request.results?.first else {
    fputs("No foreground mask was generated\n", stderr)
    exit(1)
  }

  let maskBuffer = try observation.generateScaledMaskForImage(
    forInstances: observation.allInstances,
    from: handler
  )
  let maskImage = CIImage(cvPixelBuffer: maskBuffer)
  let transparentBackground = CIImage(color: .clear).cropped(to: inputImage.extent)

  guard let blend = CIFilter(name: "CIBlendWithMask") else {
    fputs("Could not create blend filter\n", stderr)
    exit(1)
  }

  blend.setValue(inputImage, forKey: kCIInputImageKey)
  blend.setValue(transparentBackground, forKey: kCIInputBackgroundImageKey)
  blend.setValue(maskImage, forKey: kCIInputMaskImageKey)

  guard let outputImage = blend.outputImage else {
    fputs("Could not render transparent output\n", stderr)
    exit(1)
  }

  let context = CIContext()
  try context.writePNGRepresentation(
    of: outputImage,
    to: outputURL,
    format: .RGBA8,
    colorSpace: CGColorSpaceCreateDeviceRGB()
  )
} catch {
  fputs("Background removal failed: \(error)\n", stderr)
  exit(1)
}
