import { Redirect } from 'expo-router';
import Auth from './Auth';

export default function PasswordSignupRestartTest() {
  if (!__DEV__) return <Redirect href="/" />;

  return (
    <Auth
      onDone={() => {}}
      devRejectFirstSignupSessionWrite
    />
  );
}
