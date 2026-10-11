import { registerRootComponent } from 'expo';

import App from './App';
// Defines the background badge refresh, which must exist before the app is mounted.
import './src/badgeTask';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
