import { Redirect } from 'expo-router';
import TournamentDetailNativeTextScaleTest from '../src/screens/TournamentDetailNativeTextScaleTest';

export default function TournamentDetailTextScaleTestRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <TournamentDetailNativeTextScaleTest />;
}
