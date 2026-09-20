import { Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import type { Coordinates } from '../hooks/useBrowseLocation';

export interface LocationPickerProps {
  value: Coordinates | null;
  onChange: (coords: Coordinates) => void;
  /** Shown above the map, e.g. "Defaulted to your M5V neighbourhood". */
  hint?: string;
  error?: string;
  label?: string;
}

/** A region roughly 2 km across — close enough to place a pin on a street. */
const SPAN_DEGREES = 0.02;

/**
 * Place a job's location by dragging a pin.
 *
 * This is the one place in the app that captures a PRECISE point, and that is
 * intentional: `jobs.location` is the exact location, and the ~1 km coarse
 * point every browser sees is derived from it by trigger. The precise value is
 * never readable back by the client — SELECT on the column is revoked — and is
 * released only through `job_exact_location()` to the poster and the accepted
 * worker.
 *
 * Worth being explicit with the user about, which is what `hint` is for: they
 * are being asked for a real address-level point, and they should understand
 * that neighbours browsing will not see it.
 */
export const LocationPicker = ({
  value,
  onChange,
  hint,
  error,
  label = 'Where is the job?',
}: LocationPickerProps) => (
  <View>
    <Text className="mb-xs text-footnote font-medium text-text-secondary">{label}</Text>
    {hint ? <Text className="mb-sm text-caption text-text-muted">{hint}</Text> : null}

    {value ? (
      <View className="h-56 overflow-hidden rounded-lg">
        <MapView
          initialRegion={{
            latitude: value.lat,
            longitude: value.long,
            latitudeDelta: SPAN_DEGREES,
            longitudeDelta: SPAN_DEGREES,
          }}
          onPress={(event) =>
            onChange({
              lat: event.nativeEvent.coordinate.latitude,
              long: event.nativeEvent.coordinate.longitude,
            })
          }
          style={{ flex: 1 }}
        >
          <Marker
            coordinate={{ latitude: value.lat, longitude: value.long }}
            draggable
            onDragEnd={(event) =>
              onChange({
                lat: event.nativeEvent.coordinate.latitude,
                long: event.nativeEvent.coordinate.longitude,
              })
            }
            title="Job location"
          />
        </MapView>
      </View>
    ) : (
      <View className="h-56 items-center justify-center rounded-lg bg-surface-muted p-lg">
        <Text className="text-center text-footnote text-text-secondary">
          Finding your neighbourhood…
        </Text>
      </View>
    )}

    <Text className="mt-xs text-caption text-text-muted">
      Drag the pin or tap the map. Neighbours browsing only ever see a rounded, neighbourhood-level
      version of this.
    </Text>

    {error ? <Text className="mt-xs text-caption text-danger">{error}</Text> : null}
  </View>
);
