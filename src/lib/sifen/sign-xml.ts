/**
 * Firma XML-DSig (RSA-SHA256, digest SHA-256, C14N exclusivo + enveloped) sobre el borrador Neura.
 *
 * Limitaciones / notas para SET Paraguay (SIFEN):
 * - El SET puede exigir un perfil distinto (C14N, transforms, posición del nodo Signature, XAdES, etc.).
 * - Este módulo produce una firma estándar W3C XML Signature que sirve como base en Node/Vercel.
 * - Antes de producción, validar contra el manual técnico vigente y el validador oficial.
 *
 * Stack: node-forge (PKCS#12 en JS puro) + xml-crypto (compatible con despliegue serverless sin openssl CLI).
 */
import * as forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { createPrivateKey } from "node:crypto";

const XPATH_ROOT = "//*[local-name(.)='DocumentoElectronico']";
const TRANSFORMS = [
  "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
  "http://www.w3.org/2001/10/xml-exc-c14n#",
] as const;
const DIGEST = "http://www.w3.org/2001/04/xmlenc#sha256";
const SIG_ALG = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

export interface P12KeyMaterial {
  privateKeyPem: string;
  certificatePem: string;
}

/**
 * Extrae clave privada y certificado firmante del .p12.
 */
export function extractKeyAndCertFromP12(p12Buffer: Buffer, password: string): P12KeyMaterial {
  let asn1: forge.asn1.Asn1;
  try {
    const der = forge.util.createBuffer(p12Buffer.toString("binary"));
    asn1 = forge.asn1.fromDer(der);
  } catch {
    throw new Error("El archivo .p12 no es un DER PKCS#12 válido");
  }

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch {
    throw new Error("No se pudo abrir el .p12 (contraseña incorrecta o archivo corrupto)");
  }

  const pkcs8Bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
  const shrouded = pkcs8Bags[forge.pki.oids.pkcs8ShroudedKeyBag];
  const plain = keyBags[forge.pki.oids.keyBag];

  let privateKey = shrouded?.[0]?.key ?? plain?.[0]?.key;
  if (!privateKey) {
    throw new Error("El .p12 no contiene una clave privada reconocida (pkcs8ShroudedKeyBag/keyBag)");
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certs = certBags[forge.pki.oids.certBag];
  const cert = certs?.[0]?.cert;
  if (!cert) {
    throw new Error("El .p12 no contiene certificado (certBag)");
  }

  return {
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
    certificatePem: forge.pki.certificateToPem(cert),
  };
}

/**
 * Inserta Id estable en el elemento raíz si falta (facilita referencias XML-DSig).
 */
function ensureRootId(xml: string): string {
  const trimmed = xml.trim();
  if (/\bId\s*=\s*["']de-root["']/.test(trimmed)) {
    return trimmed;
  }
  return trimmed.replace(/<DocumentoElectronico(\s)/, '<DocumentoElectronico Id="de-root"$1');
}

/**
 * Firma el XML y devuelve el documento con el nodo `Signature` insertado dentro del raíz.
 */
export function signSifenDocumentoXml(xmlUtf8: string, material: P12KeyMaterial): string {
  const xmlWithId = ensureRootId(xmlUtf8);

  const privateKey = createPrivateKey({
    key: material.privateKeyPem,
    format: "pem",
  });

  const sig = new SignedXml({
    privateKey,
    publicCert: material.certificatePem,
    signatureAlgorithm: SIG_ALG,
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });

  sig.addReference({
    xpath: XPATH_ROOT,
    transforms: [...TRANSFORMS],
    digestAlgorithm: DIGEST,
  });

  sig.computeSignature(xmlWithId, {
    location: {
      reference: XPATH_ROOT,
      action: "append",
    },
  });

  return sig.getSignedXml();
}
