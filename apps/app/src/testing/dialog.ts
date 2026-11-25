/**
 * Escape on a modal dialog, which browsers turn into `cancel` then a close and happy-dom does not: the tests press Escape as a person would.
 * Installed once by the setup of the tests.
 */
export function simulateDialogEscape(): void {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !(event.target instanceof Element)) {
      return;
    }
    const dialog = event.target.closest('dialog');
    if (dialog?.open !== true) {
      return;
    }
    if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) {
      dialog.close();
    }
  });
}
