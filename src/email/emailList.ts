const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export const isValidEmail = (value: string): boolean => EMAIL_PATTERN.test(value);

export const parseEmailList = (value: string): string[] => {
  const addresses = value
    .split(/[\s,;、]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const invalid = addresses.find((address) => !isValidEmail(address));

  if (invalid) {
    throw new Error(`メールアドレスの形式が正しくありません: ${invalid}`);
  }

  return Array.from(new Set(addresses));
};
