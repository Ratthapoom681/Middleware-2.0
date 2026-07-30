export const PASSWORD_REQUIREMENTS = [
  {
    id: 'length',
    label: 'At least 12 characters',
    test: (password) => password.length >= 12,
  },
  {
    id: 'uppercase',
    label: 'One uppercase letter (A–Z)',
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: 'lowercase',
    label: 'One lowercase letter (a–z)',
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: 'special',
    label: 'One special character (!@#$…)',
    test: (password) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  },
];

export function getPasswordStrength(password = '') {
  if (!password) return 0;
  return PASSWORD_REQUIREMENTS.filter((requirement) => requirement.test(password)).length;
}
