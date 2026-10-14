export type JoinFormField =
  | 'captainProfileName'
  | 'captainGameName'
  | 'captainGameUid'
  | 'teamName'
  | `memberName:${number}`
  | `memberUid:${number}`;

export type JoinFormFieldErrors = Partial<Record<JoinFormField, string>>;

export type JoinFormValidationError = {
  message: string;
  fieldErrors: JoinFormFieldErrors;
};

export function getRegistrationServerFieldErrors(
  responseData: unknown,
  options: { isTeam: boolean; teammateCount: number },
): JoinFormFieldErrors {
  if (
    responseData === null ||
    typeof responseData !== 'object' ||
    Array.isArray(responseData)
  ) {
    return {};
  }
  const responseFieldErrors = (responseData as Record<string, unknown>).fieldErrors;
  if (
    responseFieldErrors === null ||
    typeof responseFieldErrors !== 'object' ||
    Array.isArray(responseFieldErrors)
  ) {
    return {};
  }

  const fieldErrors: JoinFormFieldErrors = {};
  for (const [field, message] of Object.entries(responseFieldErrors)) {
    if (typeof message !== 'string' || !message.trim()) continue;
    if (
      field === 'captainProfileName' ||
      field === 'captainGameName' ||
      field === 'captainGameUid' ||
      (field === 'teamName' && options.isTeam)
    ) {
      fieldErrors[field] = message;
      continue;
    }

    const teammateField = /^(memberName|memberUid):(\d+)$/.exec(field);
    if (!teammateField) continue;
    const index = Number(teammateField[2]);
    if (!Number.isInteger(index) || index < 0 || index >= options.teammateCount) continue;
    fieldErrors[field as JoinFormField] = message;
  }
  return fieldErrors;
}

type JoinFormValidationInput = {
  captainProfileName: string;
  captainGameName: string;
  captainGameUid: string;
  teamName: string;
  members: { name: string; uid: string }[];
  isTeam: boolean;
};

export function validateJoinForm(
  input: JoinFormValidationInput,
): JoinFormValidationError | null {
  const fieldErrors: JoinFormFieldErrors = {};
  let hasMissingRequiredFields = false;

  if (!input.captainProfileName.trim()) {
    const message = 'Captain Daily007 profile name is required. Add one in Profile before joining.';
    fieldErrors.captainProfileName = message;
    hasMissingRequiredFields = true;
  }

  if (!input.captainGameName.trim()) {
    fieldErrors.captainGameName = 'Captain Free Fire in-game name is required.';
    hasMissingRequiredFields = true;
  }

  if (!input.captainGameUid.trim()) {
    fieldErrors.captainGameUid = 'Captain Free Fire UID is required.';
    hasMissingRequiredFields = true;
  }

  if (input.isTeam && !input.teamName.trim()) {
    fieldErrors.teamName = 'Team name is required.';
    hasMissingRequiredFields = true;
  }

  input.members.forEach((member, index) => {
    if (!member.name.trim()) {
      fieldErrors[`memberName:${index}`] =
        `Teammate ${index + 1} Free Fire in-game name is required.`;
      hasMissingRequiredFields = true;
    }
  });

  const uidEntries: {
    field: JoinFormField;
    label: string;
    value: string;
    optional: boolean;
  }[] = [
    {
      field: 'captainGameUid',
      label: 'Captain Free Fire UID',
      value: input.captainGameUid,
      optional: false,
    },
    ...input.members.map((member, index) => ({
      field: `memberUid:${index}` as const,
      label: `Teammate ${index + 1} Free Fire UID`,
      value: member.uid,
      optional: true,
    })),
  ];
  const entriesByUid = new Map<string, (typeof uidEntries)[number][]>();

  for (const entry of uidEntries) {
    const normalizedUid = entry.value.trim().toLowerCase();
    if (!normalizedUid) continue;

    const entries = entriesByUid.get(normalizedUid) ?? [];
    entries.push(entry);
    entriesByUid.set(normalizedUid, entries);
  }

  const duplicateUidGroups = [...entriesByUid.values()].filter((entries) => entries.length > 1);
  for (const entries of duplicateUidGroups) {
    for (const entry of entries) {
      const otherLabels = entries
        .filter((other) => other !== entry)
        .map((other) => other.label);
      const others = otherLabels.length === 2
        ? `${otherLabels[0]} and ${otherLabels[1]}`
        : otherLabels.length > 2
          ? `${otherLabels.slice(0, -1).join(', ')}, and ${otherLabels[otherLabels.length - 1]}`
          : otherLabels[0];
      fieldErrors[entry.field] =
        `${entry.label} is also entered for ${others}. Enter a different UID` +
        (entry.optional ? ' or leave this optional field blank.' : '.');
    }
  }

  const hasDuplicateUids = duplicateUidGroups.length > 0;
  if (Object.keys(fieldErrors).length > 0) {
    const message = hasMissingRequiredFields && hasDuplicateUids
      ? 'Complete the highlighted required fields and use a different UID for each player.'
      : hasMissingRequiredFields
        ? 'Complete the highlighted required fields.'
        : 'Use a different UID for each player.';
    return { message, fieldErrors };
  }

  return null;
}
