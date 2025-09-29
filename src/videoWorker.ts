import {
	Output,
	Mp4OutputFormat,
	StreamTarget,
	EncodedVideoPacketSource,
	EncodedPacket,
} from 'mediabunny';

let encoder: VideoEncoder | null = null;
let output: Output | null = null;
let videoSource: EncodedVideoPacketSource | null = null;
let isRecording = false;
let frameCount = 0;

// Video encoding configuration
const encoderConfig = {
  codec: 'avc1.64003D', // H.264 baseline profile
  width: 3840,
  height: 2160,
  bitrate: 50000000, // 50 Mbps
  framerate: 60,
};

self.addEventListener('message', async (event) => {
  switch (event.data.type) {
    case 'hi':
      self.postMessage('hi there');
      break;

    case 'start':
      await startRecording(event.data.handle);
      break;

    case 'stop':
      await stopRecording();
      break;

    case 'frame':
      if (isRecording && encoder) {
        encodeFrame(event.data.frame);
      }
      break;
  }
});

async function startRecording(fileHandle: FileSystemFileHandle) {
  try {
    isRecording = true;
    frameCount = 0;

    // Create writable stream from file handle
    const writable = await fileHandle.createWritable();

    // Set up mediabunny output
    output = new Output({
      format: new Mp4OutputFormat(),
      target: new StreamTarget(writable),
    });

    // Create video source for encoded packets
    videoSource = new EncodedVideoPacketSource('avc');

    // Add video track
    output.addVideoTrack(videoSource);

    // Set up WebCodecs encoder
    encoder = new VideoEncoder({
      output: (chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) => {
        if (videoSource) {
          // Create EncodedPacket from chunk
          const packet = EncodedPacket.fromEncodedChunk(chunk);
          videoSource.add(packet, metadata);
        }
      },
      error: (error) => {
        console.error('Video encoder error:', error);
        self.postMessage({ type: 'error', data: { error: (error as Error).message } });
      }
    });

    encoder.configure(encoderConfig);

    // Start the output
    await output.start();

    self.postMessage({ type: 'started' });

  } catch (error) {
    console.error('Failed to start recording:', error);
    self.postMessage({ type: 'error', data: { error: (error as Error).message } });
    isRecording = false;
  }
}

async function stopRecording() {
  if (!isRecording) return;

  try {
    isRecording = false;

    if (encoder) {
      await encoder.flush();
      encoder.close();
      encoder = null;
    }

    if (videoSource) {
      videoSource.close();
      videoSource = null;
    }

    if (output) {
      await output.finalize();
      output = null;
    }

    self.postMessage({ type: 'stopped', data: { frameCount } });

  } catch (error) {
    console.error('Failed to stop recording:', error);
    self.postMessage({ type: 'error', data: { error: (error as Error).message } });
  }
}

function encodeFrame(frame: VideoFrame) {
  if (!encoder || !isRecording) {
    frame.close();
    return;
  }

  try {
    encoder.encode(frame);
    frameCount++;
  } catch (error) {
    console.error('Failed to encode frame:', error);
    self.postMessage({ type: 'error', data: { error: (error as Error).message } });
  } finally {
    frame.close();
  }
}
