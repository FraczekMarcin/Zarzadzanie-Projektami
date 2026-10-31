/**
 * Bezpieczne i niezawodne kopiowanie do schowka
 * Obsługuje nowoczesne API Clipboard oraz fallback dla ramek iframe i przeglądarek bez uprawnień.
 */

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Spróbuj nowoczesnego Navigator Clipboard API
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('Navigator clipboard error, próbuję metody fallback:', err);
    }
  }

  // 2. Niezawodny fallback: tymczasowy element textarea z execCommand('copy')
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    
    // Zapobiegaj przewijaniu i widoczności
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, textArea.value.length);
    
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Błąd kopiowania do schowka:', err);
    return false;
  }
}
