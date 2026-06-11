/*
 * 勘定科目の追加/編集シート。
 */
import { useState } from 'react';
import { Modal } from '@snishi/foundation/ui/Modal';
import { useDirtyGuard } from '@snishi/foundation/ui/useDirtyGuard';
import { SelectInput, TextArea, TextInput } from '@snishi/foundation/ui/Field';
import { useLedger } from '../../state/store';
import { ACCOUNT_TYPES, type Account, type AccountType } from '../../domain/types';
import { defaultRoleForType, rolesForType, type AccountRole } from '../../domain/accountRoles';
import { isAccountReferenced } from '../../domain/accountRefs';
import { newId } from '../../domain/ids';
import { nowIso } from '../../util/time';
import { accountRoleLabel, accountTypeLabel } from '../accountOptions';
import { errorText, t } from '../../i18n';
import { UI } from '../../ui-contract';

export function AccountSheet({ existing, onClose }: { existing?: Account; onClose: () => void }) {
  const { ledger, saveAccount } = useLedger();
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<AccountType>(existing?.type ?? 'expense');
  const [role, setRole] = useState<AccountRole>(
    existing?.role ?? defaultRoleForType(existing?.type ?? 'expense'),
  );
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const inUse =
    !!existing &&
    isAccountReferenced(existing.id, {
      entries: ledger?.journalEntries ?? [],
      schedules: ledger?.cashflowSchedules ?? [],
      reserves: ledger?.reserves ?? [],
      allocations: ledger?.allocations ?? [],
      monthlyCostItems: ledger?.monthlyCostItems ?? [],
    });

  const onTypeChange = (next: AccountType) => {
    setType(next);
    setRole(defaultRoleForType(next));
  };

  async function onSave() {
    if (name.trim() === '') {
      setError(t('entry.error.description-required'));
      return;
    }
    setSubmitting(true);
    const ts = nowIso();
    const account: Account = {
      id: existing?.id ?? newId(),
      name: name.trim(),
      type,
      role,
      archived: existing?.archived ?? false,
      ...(note.trim() !== '' ? { note: note.trim() } : {}),
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };
    try {
      await saveAccount(account);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSubmitting(false);
    }
  }

  const snapshot = JSON.stringify({ name, type, role, note });
  const [initialSnapshot] = useState(snapshot);
  const dirty = snapshot !== initialSnapshot;
  const { requestClose, discardConfirm } = useDirtyGuard(dirty, onClose);

  return (
    <>
      <Modal
        title={existing ? t('accounts.edit') : t('accounts.add')}
        onClose={requestClose}
        dismissMode="if-clean"
        dataUi={existing ? undefined : UI.accounts.create}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={requestClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={onSave}
              disabled={submitting}
              data-ui={UI.accounts.save}
            >
              {t('common.save')}
            </button>
          </>
        }
      >
        <TextInput
          label={t('accounts.name')}
          required
          value={name}
          onChange={(v) => {
            setName(v);
            setError(undefined);
          }}
          error={error}
        />
        <SelectInput
          label={t('accounts.type')}
          required
          value={type}
          onChange={(v) => onTypeChange(v as AccountType)}
          options={ACCOUNT_TYPES.map((tp) => ({ value: tp, label: accountTypeLabel(tp) }))}
          disabled={inUse}
          hint={inUse ? t('accounts.typeLockedHint') : undefined}
          dataUi={UI.accounts.type}
        />
        <SelectInput
          label={t('accounts.role')}
          required
          value={role}
          onChange={(v) => setRole(v as AccountRole)}
          options={rolesForType(type).map((r) => ({ value: r, label: accountRoleLabel(r) }))}
          hint={t('accounts.roleHint')}
          dataUi={UI.accounts.role}
        />
        <TextArea label={t('accounts.note')} value={note} onChange={setNote} />
      </Modal>
      {discardConfirm}
    </>
  );
}
