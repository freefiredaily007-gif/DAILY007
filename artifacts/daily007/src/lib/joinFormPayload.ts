export type JoinFormMember = { name: string; uid: string };

export type JoinFormPayloadInput = {
  captainProfileName: string;
  captainGameName: string;
  captainGameUid: string;
  teamName: string;
  members: JoinFormMember[];
};

export function buildIndividualPlayerJoinPayload({
  captainProfileName,
  captainGameName,
  captainGameUid,
}: Pick<JoinFormPayloadInput, 'captainProfileName' | 'captainGameName' | 'captainGameUid'>) {
  return {
    playerName: captainProfileName.trim(),
    captainGameName: captainGameName.trim(),
    gameUid: captainGameUid.trim(),
  };
}

export function buildJoinFormPayload({
  captainProfileName,
  captainGameName,
  captainGameUid,
  teamName,
  members,
}: JoinFormPayloadInput) {
  const players = [
    { name: captainGameName.trim(), uid: captainGameUid.trim() },
    ...members.map((member) => ({
      name: member.name.trim(),
      uid: member.uid.trim(),
    })),
  ];

  return {
    teamMembers: JSON.stringify(players),
    teamName: teamName.trim(),
    playerName: captainProfileName,
    captainGameName: captainGameName.trim(),
    gameUid: captainGameUid.trim(),
  };
}
