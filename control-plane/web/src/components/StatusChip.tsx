import React from 'react';
import { getStatusChip, StatusChipParams } from '../utils/format';

export const StatusChip: React.FC<StatusChipParams> = (props) => {
  const chip = getStatusChip(props);

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${chip.className}`}
    >
      {chip.label}
    </span>
  );
};
