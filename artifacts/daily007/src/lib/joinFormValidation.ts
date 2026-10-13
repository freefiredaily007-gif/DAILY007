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
  if (!input.captainProfileName.trim()) {
    const message = 'Captain Daily007 profile name is required. Add one in Profile before joining.';
    return { message, fieldErrors: { captainProfileName: message } };
  }

  if (!input.captainGameName.trim()) {
    const message = 'Captain Free Fire in-game name is required.';
    return { message, fieldErrors: { captainGameName: message } };
  }

  if (!input.captainGameUid.trim()) {
    const message = 'Captain Free Fire UID is required.';
    return { message, fieldErrors: { captainGameUid: message } };
  }

  if (input.isTeam && !input.teamName.trim()) {
    const message = 'Team name is required.';
    return { message, fieldErrors: { teamName: message } };
  }

  const missingTeammateNameIndex = input.members.findIndex((member) => !member.name.trim());
  if (missingTeammateNameIndex >= 0) {
    const message = `Teammate ${missingTeammateNameIndex + 1} Free Fire in-game name is required.`;
    return {
      message,
      fieldErrors: { [`memberName:${missingTeammateNameIndex}`]: message },
    };
  }

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
  const seenUids = new Map<string, (typeof uidEntries)[number]>();

  for (const entry of uidEntries) {
    const normalizedUid = entry.value.trim().toLowerCase();
    if (!normalizedUid) continue;

    const previousEntry = seenUids.get(normalizedUid);
    if (previousEntry) {
      const fieldErrors: JoinFormFieldErrors = {};
      fieldErrors[previousEntry.field] =
        `${previousEntry.label} is also entered for ${entry.label}. Enter a different UID.`;
      fieldErrors[entry.field] =
        `${entry.label} is also entered for ${previousEntry.label}. Enter a different UID` +
        (entry.optional ? ' or leave this optional field blank.' : '.');
      return {
        message: `${previousEntry.label} and ${entry.label} must have different UIDs.`,
        fieldErrors,
      };
    }

    seenUids.set(normalizedUid, entry);
  }

  return null;
}
