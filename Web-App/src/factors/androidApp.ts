/** Origin and asset-links document from the same list: the server never names an
 * app whose passkey responses it would reject, or the other way round. */
import type { AppConfig } from '../infra/config';

/** How the app appears in `clientDataJSON.origin`: base64url of the certificate hash. */
export function androidOrigins(k: Pick<AppConfig, 'androidCertificates'>): string[] {
  return k.androidCertificates.map(hex => `android:apk-key-hash:${Buffer.from(hex, 'hex').toString('base64url')}`);
}

export interface AssetStatement {
  relation: string[];
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] };
}

/** Only `get_login_creds`: login credentials yes, the domain's links no. */
export function assetlinks(k: Pick<AppConfig, 'androidCertificates' | 'androidPackage'>): AssetStatement[] | null {
  if (!k.androidCertificates.length) return null;
  return [
    {
      relation: ['delegate_permission/common.get_login_creds'],
      target: {
        namespace: 'android_app',
        package_name: k.androidPackage,
        sha256_cert_fingerprints: k.androidCertificates.map(hex => hex.match(/../g)!.join(':')),
      },
    },
  ];
}
