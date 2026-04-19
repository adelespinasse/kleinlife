// Minimal WebXR type declarations for VR support.
// The WebXR GPU Binding extension (XRGPUBinding) is not in @types/webxr so we declare it here.

interface XRSystem {
  isSessionSupported(mode: XRSessionMode): Promise<boolean>;
  requestSession(mode: XRSessionMode, options?: XRSessionInit): Promise<XRSession>;
}

type XRSessionMode = 'inline' | 'immersive-vr' | 'immersive-ar';

interface XRSessionInit {
  requiredFeatures?: string[];
  optionalFeatures?: string[];
}

interface XRSession extends EventTarget {
  requestAnimationFrame(callback: XRFrameRequestCallback): number;
  requestReferenceSpace(type: XRReferenceSpaceType): Promise<XRReferenceSpace>;
  updateRenderState(state: XRRenderStateInit): void;
  end(): Promise<void>;
  addEventListener(type: 'end', listener: EventListenerOrEventListenerObject): void;
}

type XRReferenceSpaceType = 'viewer' | 'local' | 'local-floor' | 'bounded-floor' | 'unbounded';
type XRFrameRequestCallback = (time: DOMHighResTimeStamp, frame: XRFrame) => void;

interface XRRenderStateInit {
  layers?: XRLayer[];
}

interface XRFrame {
  getViewerPose(referenceSpace: XRReferenceSpace): XRViewerPose | undefined;
}

interface XRViewerPose {
  readonly views: ReadonlyArray<XRView>;
}

interface XRView {
  readonly projectionMatrix: Float32Array;
  readonly transform: XRRigidTransform;
}

interface XRRigidTransform {
  readonly position: DOMPointReadOnly;
  readonly matrix: Float32Array;
  readonly inverse: XRRigidTransform;
}

interface XRReferenceSpace {}
interface XRLayer {}
interface XRProjectionLayer extends XRLayer {}

interface XRViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Navigator {
  readonly xr?: XRSystem;
}

// WebGPU-specific WebXR extension
interface XRGPUSubImage {
  readonly colorTexture: GPUTexture;
  readonly depthStencilTexture: GPUTexture | undefined;
  readonly viewport: XRViewport;
  readonly imageIndex: number;
}

declare class XRGPUBinding {
  constructor(session: XRSession, device: GPUDevice);
  createProjectionLayer(init: {
    colorFormat: GPUTextureFormat;
    depthStencilFormat?: GPUTextureFormat;
    scaleFactor?: number;
  }): XRProjectionLayer;
  getViewSubImage(layer: XRProjectionLayer, view: XRView): XRGPUSubImage;
}
