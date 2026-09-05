import { useTranslation } from "../../i18n/useTranslation";
import type { Participant } from "./model";
export function ParticipantSelector({
  participants,
  value,
  onChange,
  disabled,
}: {
  participants: Participant[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <label className="participant-selector">
      {t("speakingAs")}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {participants.map((person) => (
          <option key={person.id} value={person.id}>
            {t(person.labelKey)}
          </option>
        ))}
      </select>
    </label>
  );
}
