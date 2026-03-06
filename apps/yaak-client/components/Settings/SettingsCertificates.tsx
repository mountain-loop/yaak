import type { ClientCertificate } from '@yaakapp-internal/models';
import { patchModel, settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useRef } from 'react';
import { showConfirmDelete } from '../../lib/confirm';
import { Button } from '../core/Button';
import { Checkbox } from '../core/Checkbox';
import { DetailsBanner } from '../core/DetailsBanner';
import { Heading } from '../core/Heading';
import { IconButton } from '../core/IconButton';
import { InlineCode } from '../core/InlineCode';
import { PlainInput } from '../core/PlainInput';
import { Separator } from '../core/Separator';
import { HStack, VStack } from '../core/Stacks';
import { SelectFile } from '../SelectFile';

function createEmptyCertificate(): ClientCertificate {
  return {
    host: '',
    port: null,
    crtFile: null,
    keyFile: null,
    pfxFile: null,
    passphrase: null,
    enabled: true,
  };
}

interface CertificateEditorProps {
  certificate: ClientCertificate;
  index: number;
  onUpdate: (index: number, cert: ClientCertificate) => void;
  onRemove: (index: number) => void;
}

function CertificateEditor({ certificate, index, onUpdate, onRemove }: CertificateEditorProps) {
  const updateField = <K extends keyof ClientCertificate>(
    field: K,
    value: ClientCertificate[K],
  ) => {
    onUpdate(index, { ...certificate, [field]: value });
  };

  const hasPfx = Boolean(certificate.pfxFile && certificate.pfxFile.length > 0);
  const hasCrtKey = Boolean(
    (certificate.crtFile && certificate.crtFile.length > 0) ||
      (certificate.keyFile && certificate.keyFile.length > 0),
  );

  // Determine certificate type for display
  const certType = hasPfx ? 'PFX' : hasCrtKey ? 'CERT' : null;
  const defaultOpen = useRef<boolean>(!certificate.host);

  return (
    <DetailsBanner
      defaultOpen={defaultOpen.current}
      summary={
        <HStack alignItems="center" justifyContent="between" space={2} className="w-full">
          <HStack space={1.5}>
            <Checkbox
              className="ml-1"
              checked={certificate.enabled ?? true}
              title={certificate.enabled ? 'Disable certificate' : 'Enable certificate'}
              hideLabel
              onChange={(enabled) => updateField('enabled', enabled)}
            />

            {certificate.host ? (
              <InlineCode>
                {certificate.host || <>&nbsp;</>}
                {certificate.port != null && `:${certificate.port}`}
              </InlineCode>
            ) : (
              <span className="italic text-sm text-text-subtlest">Configure Certificate</span>
            )}
            {certType && <InlineCode>{certType}</InlineCode>}
          </HStack>
          <IconButton
            icon="trash"
            size="sm"
            title="Remove certificate"
            className="text-text-subtlest -mr-2"
            onClick={() => onRemove(index)}
          />
        </HStack>
      }
    >
      <VStack space={3} className="mt-2">
        <HStack space={2} alignItems="end">
          <PlainInput
            leftSlot={
              <div className="bg-surface-highlight flex items-center text-editor font-mono px-2 text-text-subtle mr-1">
                https://
              </div>
            }
            validate={(value) => {
              if (!value) return false;
              if (!/^[a-zA-Z0-9_.-]+$/.test(value)) return false;
              return true;
            }}
            label="Host"
            placeholder="example.com"
            size="sm"
            required
            defaultValue={certificate.host}
            onChange={(host) => updateField('host', host)}
          />
          <PlainInput
            label="Port"
            hideLabel
            validate={(value) => {
              if (!value) return true;
              if (Number.isNaN(parseInt(value, 10))) return false;
              return true;
            }}
            placeholder="443"
            leftSlot={
              <div className="bg-surface-highlight flex items-center text-editor font-mono px-2 text-text-subtle mr-1">
                :
              </div>
            }
            size="sm"
            className="w-24"
            defaultValue={certificate.port?.toString() ?? ''}
            onChange={(port) => updateField('port', port ? parseInt(port, 10) : null)}
          />
        </HStack>

        <Separator className="my-3" />

        <VStack space={2}>
          <SelectFile
            label="CRT File"
            noun="Cert"
            filePath={certificate.crtFile ?? null}
            size="sm"
            disabled={hasPfx}
            onChange={({ filePath }) => updateField('crtFile', filePath)}
          />
          <SelectFile
            label="KEY File"
            noun="Key"
            filePath={certificate.keyFile ?? null}
            size="sm"
            disabled={hasPfx}
            onChange={({ filePath }) => updateField('keyFile', filePath)}
          />
        </VStack>

        <Separator className="my-3" />

        <SelectFile
          label="PFX File"
          noun="Key"
          filePath={certificate.pfxFile ?? null}
          size="sm"
          disabled={hasCrtKey}
          onChange={({ filePath }) => updateField('pfxFile', filePath)}
        />

        <PlainInput
          label="Passphrase"
          size="sm"
          type="password"
          defaultValue={certificate.passphrase ?? ''}
          onChange={(passphrase) => updateField('passphrase', passphrase || null)}
        />
      </VStack>
    </DetailsBanner>
  );
}

export function SettingsCertificates() {
  const settings = useAtomValue(settingsAtom);
  const certificates = settings.clientCertificates ?? [];

  const updateCertificates = async (newCertificates: ClientCertificate[]) => {
    await patchModel(settings, { clientCertificates: newCertificates });
  };

  const handleAdd = async () => {
    const newCert = createEmptyCertificate();
    await updateCertificates([...certificates, newCert]);
  };

  const handleUpdate = async (index: number, cert: ClientCertificate) => {
    const newCertificates = [...certificates];
    newCertificates[index] = cert;
    await updateCertificates(newCertificates);
  };

  const handleRemove = async (index: number) => {
    const cert = certificates[index];
    if (cert == null) return;

    const host = cert.host || 'this certificate';
    const port = cert.port != null ? `:${cert.port}` : '';

    const confirmed = await showConfirmDelete({
      id: 'confirm-remove-certificate',
      title: 'Delete Certificate',
      description: (
        <>
          Permanently delete certificate for{' '}
          <InlineCode>
            {host}
            {port}
          </InlineCode>
          ?
        </>
      ),
    });

    if (!confirmed) return;

    const newCertificates = certificates.filter((_, i) => i !== index);

    await updateCertificates(newCertificates);
  };

  return (
    <VStack space={3}>
      <div className="mb-3">
        <HStack justifyContent="between" alignItems="start">
          <div>
            <Heading>Client Certificates</Heading>
            <p className="text-text-subtle">
              Add and manage TLS certificates on a per domain basis
            </p>
          </div>
          <Button variant="border" size="sm" color="secondary" onClick={handleAdd}>
            Add Certificate
          </Button>
        </HStack>
      </div>

      {certificates.length > 0 && (
        <VStack space={3}>
          {certificates.map((cert, index) => (
            <CertificateEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: Index is fine here
              key={index}
              certificate={cert}
              index={index}
              onUpdate={handleUpdate}
              onRemove={handleRemove}
            />
          ))}
        </VStack>
      )}
    </VStack>
  );
}
