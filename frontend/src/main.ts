import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .then(() => {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      const register = () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
        .catch(error => console.warn('AI Router service worker unavailable', error));
      if (document.readyState === 'complete') void register();
      else window.addEventListener('load', register, { once: true });
    }
  })
  .catch((err) => console.error(err));
