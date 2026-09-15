"use client";

import { type FormEvent, useState } from "react";
import { ArrowRight, ClipboardList } from "lucide-react";
import { ticketDetailsSchema, type SkillParameters, type TicketDetails } from "../lib/esp/contracts";
import { useLocale } from "./locale-provider";
import { presentedSkillName } from "../lib/esp/skill-presentation";

export const impactLabels: Record<TicketDetails["impact"], string> = {
  individual: "仅本人",
  team: "一个团队",
  organization: "多个团队 / 全公司",
};

export function TicketDetailsForm({ parameters, pending, onContinue }: {
  parameters: SkillParameters;
  pending: boolean;
  onContinue: (parameters: TicketDetails) => void;
}) {
  const { t } = useLocale();
  const [description, setDescription] = useState(parameters.description ?? "");
  const [device, setDevice] = useState(parameters.device ?? "");
  const [impact, setImpact] = useState<string>(parameters.impact ?? "");
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = ticketDetailsSchema.safeParse({ description, device: device.trim() || undefined, impact });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onContinue(parsed.data);
  }

  return (
    <form className="ticket-draft" onSubmit={submit} aria-label={t("ticketDetails")} aria-busy={pending}>
      <h4><ClipboardList size={17} />{t("ticketDetails")}</h4>
      <fieldset disabled={pending}>
        <label className="draft-description" htmlFor="ticket-description">{t("ticketDescription")}
          <textarea id="ticket-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} minLength={3} maxLength={2_000} required />
        </label>
        <label htmlFor="ticket-device">{t("ticketDeviceOptional")}
          <input id="ticket-device" value={device} onChange={(event) => setDevice(event.target.value)} maxLength={120} autoComplete="off" />
        </label>
        <label htmlFor="ticket-impact">{t("ticketImpact")}
          <select id="ticket-impact" value={impact} onChange={(event) => setImpact(event.target.value)} required>
            <option value="">{t("chooseOption")}</option>
            {(["individual", "team", "organization"] as const).map((value) => <option value={value} key={value}>{t(`impact_${value}`)}</option>)}
          </select>
        </label>
      </fieldset>
      {invalid && <p className="draft-error" role="alert">{t("ticketDetailsInvalid")}</p>}
      <button className="draft-continue" type="submit" disabled={pending}><ArrowRight size={16} />{t("ticketPrepareConfirmation")}</button>
    </form>
  );
}

export function IntentChoiceForm({ question, choices, pending, onSelect }: {
  question: string;
  choices: { id: string; name: string }[];
  pending: boolean;
  onSelect: (skillId: string) => void;
}) {
  const { locale, t } = useLocale();
  const [selected, setSelected] = useState("");
  return (
    <form className="intent-choice" aria-label={t("intentChoice")} onSubmit={(event) => {
      event.preventDefault();
      if (choices.some((choice) => choice.id === selected)) onSelect(selected);
    }}>
      <p>{t("intentChoosePrompt")}</p><details><summary>{t("originalClarification")}</summary><p>{question}</p></details>
      <label htmlFor="intent-choice">{t("intentChoose")}</label>
      <div>
        <select id="intent-choice" value={selected} onChange={(event) => setSelected(event.target.value)} required disabled={pending}>
          <option value="">{t("chooseOption")}</option>
          {choices.map((choice) => <option value={choice.id} key={choice.id}>{presentedSkillName(choice, locale)}</option>)}
        </select>
        <button type="submit" disabled={!selected || pending}><ArrowRight size={16} />{t("continueAction")}</button>
      </div>
    </form>
  );
}