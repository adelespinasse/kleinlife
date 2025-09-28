// This file was originally from
// https://webgpu.github.io/webgpu-samples/?sample=wireframe
// and licensed under the BSD 3-Clause "Revised" license (2019).
// It has been slightly modified by Alan deLespinasse.

// Show an error dialog if there's any uncaught exception or promise rejection.
// This gets set up on all pages that include util.ts.
globalThis.addEventListener('unhandledrejection', (ev) => {
  fail(`unhandled promise rejection: ${ev.reason}`);
});
globalThis.addEventListener('error', (ev) => {
  fail(`uncaught exception: ${ev.error}`);
});

/** Shows an error dialog if getting an adapter wasn't successful. */
export function quitIfAdapterNotAvailable(
  adapter: GPUAdapter | null
): asserts adapter {
  if (!('gpu' in navigator)) {
    fail('WebGPU is not available in this browser. Try Chrome.');
  }

  if (!adapter) {
    fail("WebGPU adapter not available. This may be a browser compatibility issue. Try Chrome.");
  }
}

export function quitIfLimitLessThan(
  adapter: GPUAdapter,
  limit: string,
  requiredValue: number,
  limits: Record<string, GPUSize32>
) {
  if (limit in adapter.limits) {
    const limitKey = limit as keyof GPUSupportedLimits;
    const limitValue = adapter.limits[limitKey] as number;
    if (limitValue < requiredValue) {
      fail(
        `This browser's WebGPU implementation is limited. ${limit} is ${limitValue}, \
and this program requires at least ${requiredValue}. Try a different device or a different browser.`
      );
    }
    limits[limit] = requiredValue;
  }
}

/**
 * Shows an error dialog if getting a adapter or device wasn't successful,
 * or if/when the device is lost or has an uncaptured error.
 */
export function quitIfWebGPUNotAvailable(
  adapter: GPUAdapter | null,
  device: GPUDevice | null
): asserts device {
  if (!device) {
    quitIfAdapterNotAvailable(adapter);
    fail('Unable to get a WebGPU device for an unknown reason. Try Chrome or a different device.');
    return;
  }

  device.lost.then((reason) => {
    fail(`Device lost ("${reason.reason}"):\n${reason.message}`);
  });
  device.addEventListener('uncapturederror', (ev) => {
    fail(`Uncaptured error:\n${ev.error.message}`);
  });
}

/** Fail by showing a console error, and dialog box if possible. */
const fail = (() => {
  type ErrorOutput = { show(msg: string): void };

  function createErrorOutput() {
    if (typeof document === 'undefined') {
      // Not implemented in workers.
      return {
        show(msg: string) {
          console.error(msg);
        },
      };
    }

    const dialogBox = document.createElement('dialog');
    dialogBox.close();
    document.body.append(dialogBox);

    const dialogText = document.createElement('pre');
    dialogText.style.whiteSpace = 'pre-wrap';
    dialogBox.append(dialogText);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'OK';
    closeBtn.onclick = () => dialogBox.close();
    dialogBox.append(closeBtn);

    return {
      show(msg: string) {
        // Don't overwrite the dialog message while it's still open
        // (show the first error, not the most recent error).
        if (!dialogBox.open) {
          dialogText.textContent = msg;
          dialogBox.showModal();
        }
      },
    };
  }

  let output: ErrorOutput | undefined;

  return (message: string) => {
    if (!output) output = createErrorOutput();

    output.show(message);
    throw new Error(message);
  };
})();
