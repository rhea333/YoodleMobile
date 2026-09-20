import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, Chip, JobCard, TextInput } from '../components';
import {
  useBrowseJobs,
  useBrowseLocation,
  useDebouncedValue,
  useNearbyCategories,
  useTheme,
} from '../hooks';
import type { MainStackParamList } from '../navigation/types';
import { DEFAULT_RADIUS_METERS, signOut } from '../services';
import { selectUnreadCount, useNotificationsStore } from '../state/notifications';
import { spacing } from '../theme';
import type { BrowseJobRow } from '../types/database';

type Props = NativeStackScreenProps<MainStackParamList, 'Home'>;

type ViewMode = 'list' | 'map';

/** Rough metres per degree of latitude — good enough to frame a map region. */
const METERS_PER_DEGREE_LAT = 111_320;

interface MapCluster {
  key: string;
  lat: number;
  long: number;
  jobs: BrowseJobRow[];
}

/**
 * Groups jobs that share a coarse point.
 *
 * Not an optimisation — a correctness fix for the map. Locations are rounded to
 * ~1 km, so a busy neighbourhood puts dozens of jobs on the SAME coordinate and
 * their pins stack into what looks like a single job. Grouping makes the pin
 * honest about how many listings it stands for.
 */
const clusterByPoint = (jobs: BrowseJobRow[]): MapCluster[] => {
  const clusters = new Map<string, MapCluster>();

  for (const job of jobs) {
    const key = `${job.lat},${job.long}`;
    const existing = clusters.get(key);
    if (existing) {
      existing.jobs.push(job);
    } else {
      clusters.set(key, { key, lat: job.lat, long: job.long, jobs: [job] });
    }
  }

  return Array.from(clusters.values());
};

/**
 * Browse jobs near the signed-in user. Read-only: no posting, and applying is
 * an inert placeholder on the detail screen.
 *
 * Everything shown here is neighbourhood-level. `browse_jobs` returns only the
 * coarse point, and the exact column is unreadable by any client role, so
 * neither the list nor the map can render a precise position even by accident.
 */
export const HomeScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const unreadCount = useNotificationsStore(selectUnreadCount);
  const clearNotifications = useNotificationsStore((state) => state.clear);

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [category, setCategory] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  // Debounced so typing does not refetch page 1 on every keystroke.
  const search = useDebouncedValue(searchInput, 300);

  const location = useBrowseLocation();
  const coords = location.coords;

  const categoriesQuery = useNearbyCategories(coords, DEFAULT_RADIUS_METERS);
  const jobsQuery = useBrowseJobs({
    coords,
    radiusMeters: DEFAULT_RADIUS_METERS,
    category,
    search,
  });

  const jobs = jobsQuery.data?.pages.flat() ?? [];
  const radiusKm = Math.round(DEFAULT_RADIUS_METERS / 1000);
  const hasFilters = category !== null || search.trim().length > 0;

  const handleSignOut = async () => {
    await signOut();
    // Drop every cached query with the session. Without this, the next account
    // to sign in on this device would briefly see the previous one's profile
    // and job list from cache before the refetch lands.
    queryClient.clear();
    // Same reasoning, and it matters more here: the notification feed holds
    // message previews. They must not survive into another account's session.
    clearNotifications();
  };

  const clearFilters = () => {
    setCategory(null);
    setSearchInput('');
  };

  const filters = (
    <View>
      <View className="flex-row items-center justify-between">
        <View className="flex-1">
          <Text className="text-heading font-bold text-text-primary">Jobs near you</Text>
          <Text className="mt-xs text-footnote text-text-secondary">
            Open jobs within about {radiusKm} km of your neighbourhood.
          </Text>
        </View>
        <View className="flex-row items-center">
          {/*
            The only entry to the phase-1 component gallery. Dev-only on both
            sides: this control and the route itself are compiled out of a
            release bundle, so it is not a hidden feature shipped to users.
          */}
          {__DEV__ ? (
            <Button
              accessibilityLabel="Open the design system gallery"
              label="▦"
              onPress={() => navigation.navigate('DesignSystem')}
              size="sm"
              variant="ghost"
            />
          ) : null}
          <View>
            <Button
              accessibilityLabel={
                unreadCount > 0 ? `Notifications, ${unreadCount} new` : 'Notifications'
              }
              label="Alerts"
              onPress={() => navigation.navigate('Notifications')}
              size="sm"
              variant="ghost"
            />
            {unreadCount > 0 ? (
              <View className="absolute -right-xs -top-xs" pointerEvents="none">
                <Badge label={unreadCount > 9 ? '9+' : String(unreadCount)} tone="accent" />
              </View>
            ) : null}
          </View>
          <Button
            accessibilityLabel="Sign out"
            label="Sign out"
            onPress={() => void handleSignOut()}
            variant="ghost"
          />
        </View>
      </View>

      <View className="mt-lg">
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearchInput}
          placeholder="Search jobs, e.g. shovel, dog, moving"
          returnKeyType="search"
          value={searchInput}
        />
      </View>

      {categoriesQuery.data && categoriesQuery.data.length > 0 ? (
        <ScrollView
          className="mt-md"
          contentContainerStyle={{ gap: spacing.xs, paddingRight: spacing.lg }}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          <Chip label="All" onPress={() => setCategory(null)} selected={category === null} />
          {categoriesQuery.data.map((item) => (
            <Chip
              count={item.job_count}
              key={item.category}
              label={item.category}
              onPress={() => setCategory(category === item.category ? null : item.category)}
              selected={category === item.category}
            />
          ))}
        </ScrollView>
      ) : null}

      <View className="mt-md flex-row items-center justify-between">
        <View className="flex-row items-center gap-xs">
          <Chip label="List" onPress={() => setViewMode('list')} selected={viewMode === 'list'} />
          <Chip label="Map" onPress={() => setViewMode('map')} selected={viewMode === 'map'} />
        </View>
        {/* Entry points to the phase 5 posting flow. The browse behaviour below
            is untouched. */}
        <View className="flex-row items-center gap-xs">
          <Button
            label="Offers"
            onPress={() => navigation.navigate('Offers')}
            size="sm"
            variant="ghost"
          />
          <Button
            label="My jobs"
            onPress={() => navigation.navigate('MyJobs')}
            size="sm"
            variant="ghost"
          />
          <Button label="Post a job" onPress={() => navigation.navigate('PostJob')} size="sm" />
        </View>
      </View>
    </View>
  );

  /** Location gate, then the query's own states. */
  const renderContent = () => {
    if (location.status === 'loading') {
      return (
        <View className="flex-1 items-center justify-center p-lg">
          <ActivityIndicator color={colors.primary} size="large" />
          <Text className="mt-md text-footnote text-text-secondary">
            Finding your neighbourhood…
          </Text>
        </View>
      );
    }

    if (location.status === 'denied' || location.status === 'error') {
      return (
        <View className="flex-1 items-center justify-center p-lg">
          <Text className="text-center text-body text-text-secondary">{location.message}</Text>
          <View className="mt-lg">
            <Button label="Try again" onPress={location.retry} variant="secondary" />
          </View>
        </View>
      );
    }

    if (jobsQuery.isPending) {
      return (
        <View className="flex-1 items-center justify-center p-lg">
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    }

    if (jobsQuery.isError) {
      return (
        <View className="flex-1 items-center justify-center p-lg">
          <Text className="text-center text-body text-text-secondary">
            {jobsQuery.error.message}
          </Text>
          <View className="mt-lg">
            <Button
              label="Try again"
              onPress={() => void jobsQuery.refetch()}
              variant="secondary"
            />
          </View>
        </View>
      );
    }

    if (jobs.length === 0) {
      // Two different empties. "Nothing matches your filters" is recoverable by
      // clearing them; "no jobs near you yet" is not, and saying the wrong one
      // sends the user looking for a control that will not help.
      return (
        <View className="flex-1 items-center justify-center p-lg">
          <Text className="text-center text-title font-semibold text-text-primary">
            {hasFilters ? 'Nothing matches those filters' : 'No jobs near you yet'}
          </Text>
          <Text className="mt-sm text-center text-body text-text-secondary">
            {hasFilters
              ? 'Try a different category, or clear your search.'
              : `Nobody within ${radiusKm} km has posted an open job. Check back soon.`}
          </Text>
          {hasFilters ? (
            <View className="mt-lg">
              <Button label="Clear filters" onPress={clearFilters} variant="secondary" />
            </View>
          ) : null}
        </View>
      );
    }

    if (viewMode === 'map' && coords) {
      const latitudeDelta = Math.max(0.02, (DEFAULT_RADIUS_METERS * 2.4) / METERS_PER_DEGREE_LAT);

      return (
        <View className="flex-1 overflow-hidden rounded-lg">
          <MapView
            initialRegion={{
              latitude: coords.lat,
              longitude: coords.long,
              latitudeDelta,
              longitudeDelta: latitudeDelta,
            }}
            style={{ flex: 1 }}
          >
            {clusterByPoint(jobs).map((cluster) => {
              const single = cluster.jobs.length === 1 ? cluster.jobs[0] : undefined;

              return (
                <Marker
                  coordinate={{ latitude: cluster.lat, longitude: cluster.long }}
                  description={
                    single ? single.category : 'Approximate area — tap to see these in the list'
                  }
                  key={cluster.key}
                  onCalloutPress={() => {
                    if (single) {
                      navigation.navigate('JobDetail', { jobId: single.id });
                    } else {
                      setViewMode('list');
                    }
                  }}
                  title={single ? single.title : `${cluster.jobs.length} jobs in this area`}
                />
              );
            })}
          </MapView>
        </View>
      );
    }

    return (
      <FlatList
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing['2xl'], gap: spacing.md }}
        data={jobs}
        keyExtractor={(job) => job.id}
        ListFooterComponent={
          jobsQuery.isFetchingNextPage ? (
            <View className="py-lg">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : !jobsQuery.hasNextPage && jobs.length > 0 ? (
            <Text className="py-lg text-center text-caption text-text-muted">
              That&rsquo;s everything within {radiusKm} km.
            </Text>
          ) : null
        }
        onEndReached={() => {
          if (jobsQuery.hasNextPage && !jobsQuery.isFetchingNextPage) {
            void jobsQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            onRefresh={() => void jobsQuery.refetch()}
            refreshing={jobsQuery.isRefetching && !jobsQuery.isFetchingNextPage}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => (
          <JobCard
            job={item}
            onPress={() => navigation.navigate('JobDetail', { jobId: item.id })}
          />
        )}
        showsVerticalScrollIndicator={false}
      />
    );
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingHorizontal: spacing.lg }}>
      <View className="pt-lg">{filters}</View>
      <View className="mt-lg flex-1">{renderContent()}</View>
    </View>
  );
};
