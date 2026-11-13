export interface PasswordPolicyContext {
  email?: string;
  name?: string;
}

export interface PasswordValidationResult {
  ok: boolean;
  errors: string[];
}

export interface PasswordRequirementCheck {
  id: 'length' | 'notCommon' | 'noPersonalInfo' | 'notSequentialOrRepeated';
  label: string;
  met: boolean;
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

// Wbudowana lista >350 najczęstszych haseł (polskich i angielskich)
const COMMON_PASSWORDS_RAW: readonly string[] = [
  // Przykłady bazowe i wzorce klawiaturowe
  'haslo', 'haslo123', 'haslo1234', 'haslo12345', 'haslo123456', 'moje', 'mojehaslo', 'tajne', 'tajnehaslo',
  'sekret', 'sekretne', 'bezpieczenstwo', 'konto', 'logowanie', 'dostep', 'uzytkownik', 'pracownik', 'klucz',
  'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssword', 'p@ssw0rd',
  'pass', 'passwd', 'pass123', 'pass1234', 'admin', 'admin123', 'admin1234', 'administrator', 'root', 'toor',
  'superadmin', 'manager', 'master', 'default', 'guest', 'gosc', 'test', 'test123', 'testowy', 'demo',
  'qwerty', 'qwerty123', 'qwerty1234', 'qwerty12345', 'qwerty123456', 'qwertyuiop', 'qwertz', 'azerty',
  'asdf', 'asdfgh', 'asdfghjkl', 'zxcv', 'zxcvbn', 'zxcvbnm', 'qazwsx', 'qazwsxedc', 'zaq12wsx', 'zaq12wsxcde3',
  '1qaz2wsx', '1qaz2wsx3edc', '1q2w3e4r', '1q2w3e4r5t', '1234qwer', 'qwer1234', 'abcd1234', 'abc123',
  '123456', '1234567', '12345678', '123456789', '1234567890', '123456789012', '0123456789', '012345678901',
  '987654321', '9876543210', '987654321098', '111111', '000000', '654321', '7777777', '88888888',

  // Polskie popularne słowa i hasła
  'polska', 'warszawa', 'krakow', 'gdansk', 'wroclaw', 'poznan', 'szczecin', 'lublin', 'katowice', 'bydgoszcz',
  'bialystok', 'gdynia', 'czestochowa', 'radom', 'sosnowiec', 'torun', 'kielce', 'rzeszow', 'gliwice', 'zabrze',
  'olsztyn', 'bielsko', 'zakopane', 'mazury', 'baltyk', 'tatry', 'wisla', 'odra', 'legia', 'lech',
  'kocham', 'kochamcie', 'milosc', 'serce', 'buziaki', 'kochanie', 'skarbie', 'kotek', 'kotek123', 'koteczek',
  'piesek', 'pies', 'reksio', 'azor', 'burek', 'misiek', 'misio', 'slonce', 'sloneczko', 'ksiezyc',
  'gwiazda', 'gwiazdka', 'niebo', 'chmura', 'deszcz', 'wiosna', 'lato', 'jesien', 'zima', 'wakacje',
  'kwiaty', 'kwiatek', 'roza', 'tulipan', 'drzewo', 'las', 'gory', 'morze', 'jezioro', 'rzeka',
  'dom', 'domek', 'rodzina', 'mama', 'tata', 'babcia', 'dziadek', 'dziecko', 'syn', 'corka',
  'szkola', 'praca', 'biuro', 'firma', 'pracownia', 'projekt', 'projekty', 'budowa', 'architekt', 'architektura',
  'komputer', 'laptop', 'internet', 'telefon', 'smartfon', 'klawiatura', 'monitor', 'myszka', 'drukarka', 'serwer',
  'samochod', 'autko', 'rower', 'motocykl', 'pociag', 'samolot', 'podroz', 'turystyka', 'sport', 'pilka',
  'siatkowka', 'koszykowka', 'tenis', 'bieganie', 'plywanie', 'rowerzysta', 'kawa', 'herbata', 'piwo', 'wino',
  'czekolada', 'ciasto', 'tort', 'paczek', 'pizza', 'obiad', 'sniadanie', 'kolacja', 'jablko', 'banan',
  'zielony', 'niebieski', 'czerwony', 'czarny', 'bialy', 'zolty', 'pomaranczowy', 'fioletowy', 'rozowy', 'szary',
  'styczen', 'luty', 'marzec', 'kwiecien', 'maj', 'czerwiec', 'lipiec', 'sierpien', 'wrzesien', 'pazdziernik',
  'listopad', 'grudzien', 'poniedzialek', 'wtorek', 'sroda', 'czwartek', 'piatek', 'sobota', 'niedziela',
  'styczen2025', 'styczen2026', 'wiosna2025', 'wiosna2026', 'lato2025', 'lato2026', 'polska123', 'warszawa123',

  // Polskie imiona często używane jako hasła
  'anna', 'ania', 'katarzyna', 'kasia', 'malgorzata', 'gosia', 'agnieszka', 'barbara', 'basia', 'ewa',
  'magdalena', 'magda', 'joanna', 'asia', 'monika', 'karolina', 'natalia', 'aleksandra', 'ola', 'justyna',
  'paulina', 'sylwia', 'beata', 'dorota', 'martyna', 'zuzanna', 'zuzia', 'julia', 'maja', 'lena',
  'piotr', 'piotrek', 'krzysztof', 'krzysiek', 'andrzej', 'tomasz', 'tomek', 'pawel', 'michal', 'marcin',
  'marek', 'grzegorz', 'grzesiek', 'lukasz', 'adam', 'mateusz', 'jakub', 'kuba', 'wojciech', 'wojtek',
  'robert', 'rafal', 'jacek', 'mariusz', 'sebastian', 'kamil', 'szymon', 'damian', 'jan', 'janek',
  'janusz', 'stanislaw', 'zbigniew', 'maciej', 'maciek', 'dawid', 'bartek', 'bartosz', 'patryk', 'przemek',

  // Angielskie popularne hasła (top leaked)
  'iloveyou', 'welcome', 'welcome1', 'welcome123', 'letmein', 'letmein123', 'monkey', 'dragon', 'baseball', 'football',
  'soccer', 'hockey', 'basketball', 'superman', 'batman', 'spiderman', 'starwars', 'matrix', 'pokemon', 'naruto',
  'sunshine', 'princess', 'shadow', 'charlie', 'michael', 'jennifer', 'jessica', 'ashley', 'matthew', 'daniel',
  'andrew', 'anthony', 'william', 'david', 'richard', 'joseph', 'thomas', 'charles', 'christopher', 'joshua',
  'trustno1', 'whatever', 'freedom', 'changeme', 'secret', 'secrets', 'private', 'personal', 'business', 'company',
  'office', 'computer', 'internet', 'network', 'system', 'security', 'access', 'login', 'user', 'member',
  'summer', 'winter', 'spring', 'autumn', 'holiday', 'vacation', 'rainbow', 'flower', 'diamond', 'crystal',
  'angel', 'angels', 'heaven', 'forever', 'always', 'happy', 'smile', 'lucky', 'star', 'stars',
  'chocolate', 'cookie', 'cookies', 'coffee', 'butterfly', 'dolphin', 'tiger', 'lion', 'eagle', 'dragonfly',
  'killer', 'hunter', 'buster', 'ginger', 'pepper', 'muffin', 'pumpkin', 'teddy', 'snoopy', 'garfield',
  'chelsea', 'liverpool', 'arsenal', 'barcelona', 'realmadryt', 'manchester', 'juventus', 'ferrari', 'porsche', 'mercedes',
  'bmw', 'audi', 'toyota', 'honda', 'yamaha', 'samsung', 'apple', 'iphone', 'google', 'microsoft',
  'windows', 'linux', 'ubuntu', 'oracle', 'python', 'javascript', 'developer', 'programmer', 'engineer', 'architect',
  'passphrase', 'correcthorse', 'hunter2', 'asdf1234', 'zxcv1234', 'qwerasdf', '1234abcd', '000000000000',
];

const POLISH_CHAR_MAP: Record<string, string> = {
  'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
};

function foldDiacritics(str: string): string {
  return str.replace(/[ąćęłńóśźż]/g, (ch) => POLISH_CHAR_MAP[ch] || ch);
}

const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  COMMON_PASSWORDS_RAW.flatMap((w) => {
    const lower = w.toLowerCase();
    return [lower, foldDiacritics(lower)];
  })
);

export const COMMON_PASSWORD_LIST_SIZE = COMMON_PASSWORDS_RAW.length;

function isCommonPassword(password: string): boolean {
  const lower = password.toLowerCase();
  const folded = foldDiacritics(lower);

  const candidates = new Set<string>([
    lower,
    folded,
    // Usunięcie znaków specjalnych na końcu (np. 'zaq12wsx!' -> 'zaq12wsx', '123456789012!' -> '123456789012')
    lower.replace(/[^a-z0-9ąćęłńóśźż]+$/g, ''),
    folded.replace(/[^a-z0-9]+$/g, ''),
    // Usunięcie cyfr i znaków specjalnych na końcu (np. 'haslo123456' -> 'haslo', 'password1234!' -> 'password')
    lower.replace(/[^a-ząćęłńóśźż]+$/g, ''),
    folded.replace(/[^a-z]+$/g, ''),
  ]);

  for (const c of candidates) {
    if (c && COMMON_PASSWORDS.has(c)) {
      return true;
    }
  }
  return false;
}

function containsPersonalInfo(password: string, context: PasswordPolicyContext): boolean {
  const lower = password.toLowerCase();
  const folded = foldDiacritics(lower);
  const tokens = new Set<string>();

  if (context.email && typeof context.email === 'string') {
    const localPart = context.email.trim().toLowerCase().split('@')[0] || '';
    if (localPart.length >= 3) {
      tokens.add(localPart);
      tokens.add(foldDiacritics(localPart));
    }
    for (const seg of localPart.split(/[._+\-\d]+/)) {
      if (seg.length >= 3) {
        tokens.add(seg);
        tokens.add(foldDiacritics(seg));
      }
    }
  }

  if (context.name && typeof context.name === 'string') {
    for (const part of context.name.trim().toLowerCase().split(/[\s._\-/\\,]+/)) {
      if (part.length >= 3) {
        tokens.add(part);
        tokens.add(foldDiacritics(part));
      }
    }
  }

  for (const token of tokens) {
    if (lower.includes(token) || folded.includes(token)) {
      return true;
    }
  }
  return false;
}

const KNOWN_SEQUENCES = [
  'abcdefghijklmnopqrstuvwxyz',
  'zyxwvutsrqponmlkjihgfedcba',
  '01234567890123456789',
  '98765432109876543210',
  'qwertyuiop',
  'poiuytrewq',
  'asdfghjkl',
  'lkjhgfdsa',
  'zxcvbnm',
  'mnbvcxz',
];

function isRepeatedOrSequential(password: string): boolean {
  if (!password) return false;
  const lower = password.toLowerCase();

  // Jeden powtarzany znak (np. 'aaaaaaaaaaaa', '111111111111')
  if (new Set(lower).size === 1) {
    return true;
  }

  // Powtarzany krótki wzorzec 1-4 znakowy wypełniający całe hasło (np. 'abababababab', '123123123123')
  for (let period = 1; period <= Math.min(4, Math.floor(lower.length / 2)); period++) {
    if (lower.length % period === 0) {
      const unit = lower.slice(0, period);
      if (unit.repeat(lower.length / period) === lower) {
        return true;
      }
    }
  }

  // Całe hasło (lub po odcięciu końcowych znaków niealfanumerycznych) będące prostą sekwencją
  const core = lower.replace(/[^a-z0-9]+$/g, '');
  for (const seq of KNOWN_SEQUENCES) {
    if (lower.length >= 6 && seq.includes(lower)) return true;
    if (core.length >= 6 && seq.includes(core)) return true;
  }

  // Wykrywanie długich ciągłych sekwencji (min. 6 kolejnych znaków alfanumerycznych lub z wiersza klawiatury)
  for (const seq of KNOWN_SEQUENCES) {
    for (let i = 0; i <= seq.length - 6; i++) {
      const sub = seq.slice(i, i + 6);
      if (lower.includes(sub)) {
        return true;
      }
    }
  }

  // Wykrywanie dowolnej ciągłej sekwencji ASCII (+/- 1 kod znaku) o długości >= 6 dla liter lub cyfr
  let ascRun = 1;
  let descRun = 1;
  for (let i = 1; i < lower.length; i++) {
    const prev = lower.charCodeAt(i - 1);
    const curr = lower.charCodeAt(i);
    const isAlnumPair =
      /[a-z0-9]/.test(lower[i - 1]) && /[a-z0-9]/.test(lower[i]);
    if (isAlnumPair && curr - prev === 1) {
      ascRun += 1;
      descRun = 1;
    } else if (isAlnumPair && prev - curr === 1) {
      descRun += 1;
      ascRun = 1;
    } else {
      ascRun = 1;
      descRun = 1;
    }
    if (ascRun >= 6 || descRun >= 6) {
      return true;
    }
  }

  return false;
}

export function getPasswordPolicyChecks(
  password: string,
  context: PasswordPolicyContext = {}
): PasswordRequirementCheck[] {
  const pwd = typeof password === 'string' ? password : String(password ?? '');
  const hasAnyChar = pwd.length > 0;
  const lengthOk = pwd.length >= PASSWORD_MIN_LENGTH && pwd.length <= PASSWORD_MAX_LENGTH;
  const notCommonOk = hasAnyChar && !isCommonPassword(pwd);
  const noPersonalInfoOk = hasAnyChar && !containsPersonalInfo(pwd, context);
  const notSeqOrRepOk = hasAnyChar && !isRepeatedOrSequential(pwd);

  return [
    {
      id: 'length',
      label: `Długość od ${PASSWORD_MIN_LENGTH} do ${PASSWORD_MAX_LENGTH} znaków`,
      met: lengthOk,
    },
    {
      id: 'notCommon',
      label: 'Brak na liście najczęstszych haseł (np. haslo123, qwerty)',
      met: notCommonOk,
    },
    {
      id: 'noPersonalInfo',
      label: 'Nie zawiera imienia, nazwiska ani loginu z e-maila',
      met: noPersonalInfoOk,
    },
    {
      id: 'notSequentialOrRepeated',
      label: 'Brak jednego powtarzanego znaku i prostych sekwencji (abcd…, 1234…)',
      met: notSeqOrRepOk,
    },
  ];
}

export function validatePassword(
  password: string,
  context: PasswordPolicyContext = {}
): PasswordValidationResult {
  const pwd = typeof password === 'string' ? password : String(password ?? '');
  const errors: string[] = [];

  if (pwd.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Hasło musi zawierać co najmniej ${PASSWORD_MIN_LENGTH} znaków.`);
  } else if (pwd.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Hasło może mieć maksymalnie ${PASSWORD_MAX_LENGTH} znaków.`);
  }

  if (pwd.length > 0) {
    if (isCommonPassword(pwd)) {
      errors.push('Hasło znajduje się na liście popularnych i łatwych do odgadnięcia haseł.');
    }
    if (containsPersonalInfo(pwd, context)) {
      errors.push('Hasło nie może zawierać imienia, nazwiska ani części adresu e-mail użytkownika.');
    }
    if (isRepeatedOrSequential(pwd)) {
      errors.push('Hasło nie może składać się z powtarzanego znaku ani prostej sekwencji znaków.');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
