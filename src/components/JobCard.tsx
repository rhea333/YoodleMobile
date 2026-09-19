import { Text, View } from 'react-native';

import { formatBudget, formatDistance } from '../services';
import type { BrowseJobRow } from '../types/database';
import { Badge } from './Badge';
import { Card } from './Card';

export interface JobCardProps {
  job: BrowseJobRow;
  onPress?: () => void;
  testID?: string;
}

/**
 * One job in the browse list.
 *
 * The distance shown comes from the COARSE point, and `formatDistance` rounds
 * sub-kilometre figures to the nearest 50 m on purpose — the underlying
 * location is only accurate to about a kilometre, so "437 m away" would state a
 * precision the data does not have, and would invite someone to treat it as a
 * fix on the address.
 */
export const JobCard = ({ job, onPress, testID }: JobCardProps) => {
  const budget = formatBudget(job.budget);

  return (
    <Card onPress={onPress} testID={testID} title={job.title} variant="outlined">
      {job.description ? (
        <Text className="text-body text-text-secondary" numberOfLines={2}>
          {job.description}
        </Text>
      ) : null}

      <View className="mt-md flex-row flex-wrap items-center gap-xs">
        <Badge label={formatDistance(job.distance_meters)} tone="info" />
        <Badge label={job.category} tone="neutral" />
        {budget ? <Badge label={budget} tone="primary" /> : null}
      </View>
    </Card>
  );
};
