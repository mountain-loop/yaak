import { useState } from 'react';
import { Button } from '../core/Button';
import { Select } from '../core/Select';
import { HStack, VStack } from '../core/Stacks';

interface Props {
  branches: string[];
  onCancel: () => void;
  onSelect: (branch: string) => void;
  selectText: string;
}

export function BranchSelectionDialog({ branches, onCancel, onSelect, selectText }: Props) {
  const [branch, setBranch] = useState<string>('__NONE__');
  return (
    <VStack
      className="mb-4"
      as="form"
      space={4}
      onSubmit={(e) => {
        e.preventDefault();
        onSelect(branch);
      }}
    >
      <Select
        name="branch"
        hideLabel
        label="Branch"
        value={branch}
        options={branches.map((b) => ({ label: b, value: b }))}
        onChange={setBranch}
      />
      <HStack space={2} justifyContent="end">
        <Button onClick={onCancel} variant="border" color="secondary">
          Cancel
        </Button>
        <Button type="submit" color="primary">
          {selectText}
        </Button>
      </HStack>
    </VStack>
  );
}
