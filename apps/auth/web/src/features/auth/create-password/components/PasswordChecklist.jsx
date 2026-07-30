import { PASSWORD_REQUIREMENTS } from '../password-policy';

function ChecklistIcon({ passed }) {
  return passed ? (
    <svg
      className="checklist-icon passed"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 8.25 3.1 3.1L13 4.75" />
    </svg>
  ) : (
    <svg
      className="checklist-icon pending"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="m4.5 4.5 7 7m0-7-7 7" />
    </svg>
  );
}

export default function PasswordChecklist({ password }) {
  return (
    <ul className="password-checklist" aria-label="Password requirements">
      {PASSWORD_REQUIREMENTS.map((requirement) => {
        const passed = requirement.test(password);

        return (
          <li
            className={`checklist-item ${passed ? 'passed' : 'pending'}`}
            key={requirement.id}
          >
            <ChecklistIcon passed={passed} />
            <span>{requirement.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
