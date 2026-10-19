import { Redirect } from 'expo-router';
import TournamentPullRefreshNativeTest from '../src/screens/TournamentPullRefreshNativeTest';

export default function TournamentPullRefreshTestRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <TournamentPullRefreshNativeTest />;
}
