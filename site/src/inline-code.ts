// Runtime messages mark code (identifiers, error codes, option names) with
// backticks, as Markdown does. renderText turns each marked span into a
// <code> element, so toasts, status lines and tables set it in the code font
// like the page's static text. plainText drops the marks where only a plain
// string fits: ECharts labels and accessible chart descriptions.
// Why backticks instead of HTML in the messages: the values filled into a
// message (error text, file names) then stay text and can never become markup.
// VERIFIED: (site e2e) the backpressure toast renders `QUEUE_FULL` as <code>.

/** Writes `text` into `element`, each `span` between backticks as a <code> element. */
export function renderText(element: Element, text: string): void {
  element.replaceChildren(...text.split('`').map((part, index) => {
    if (index % 2 === 0) return part;
    const code = document.createElement('code');
    code.textContent = part;
    return code;
  }));
}

/** `text` without its code marks. */
export const plainText = (text: string): string => text.replaceAll('`', '');
