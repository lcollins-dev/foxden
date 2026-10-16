import { Module } from '@nestjs/common';

import { AuthFirefoxModule } from './auth/auth-firefox.module';
import { OauthFirefoxModule } from './oauth/oauth-firefox.module';
import { ProfileFirefoxModule } from './profile/profile-firefox.module';
import { StorageFirefoxModule } from './storage/storage-firefox.module';
import { TokenserverFirefoxModule } from './tokenserver/tokenserver-firefox.module';
import { WellKnownFirefoxModule } from './well-known/well-known-firefox.module';

/** Every server stock Firefox talks to, in Mozilla's wire formats, on the web app's origin. */
@Module({
  imports: [
    OauthFirefoxModule,
    TokenserverFirefoxModule,
    StorageFirefoxModule,
    AuthFirefoxModule,
    ProfileFirefoxModule,
    WellKnownFirefoxModule,
  ],
})
export class FirefoxModule {}
