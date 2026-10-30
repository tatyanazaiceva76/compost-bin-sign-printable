export function resetProjectForm(form, nativeReset = globalThis.HTMLFormElement?.prototype?.reset) {
  if (!form || typeof nativeReset !== 'function') throw new TypeError('Native HTMLFormElement.reset is unavailable.');
  nativeReset.call(form);
}
