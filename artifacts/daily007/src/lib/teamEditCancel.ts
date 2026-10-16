export type TeamEditCancelActions = {
  keepEditing: () => void;
  discard: () => void;
};

export function requestTeamEditCancel(
  hasUnsavedChanges: boolean,
  onCancel: () => void,
  showConfirmation: (actions: TeamEditCancelActions) => void,
): void {
  if (!hasUnsavedChanges) {
    onCancel();
    return;
  }

  showConfirmation({
    keepEditing: () => {},
    discard: onCancel,
  });
}
