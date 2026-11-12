/** Herkunft und Asset-Links-Dokument aus derselben Liste: Der Server weist
 * nie eine App aus, deren Passkey-Antworten er abwiese, oder umgekehrt. */
import { konfig } from '../infra/konfig';

/** So steht die App in `clientDataJSON.origin`: base64url des Zertifikat-Hashes. */
export function androidHerkuenfte(): string[] {
  return konfig().androidZertifikate.map(
    hex => `android:apk-key-hash:${Buffer.from(hex, 'hex').toString('base64url')}`,
  );
}

export interface AssetStatement {
  relation: string[];
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] };
}

/** Nur `get_login_creds`: Anmeldedaten ja, die Links der Domain nicht. */
export function assetlinks(): AssetStatement[] | null {
  const k = konfig();
  if (!k.androidZertifikate.length) return null;
  return [
    {
      relation: ['delegate_permission/common.get_login_creds'],
      target: {
        namespace: 'android_app',
        package_name: k.androidPaket,
        sha256_cert_fingerprints: k.androidZertifikate.map(hex => hex.match(/../g)!.join(':')),
      },
    },
  ];
}
