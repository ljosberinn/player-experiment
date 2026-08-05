import { Slider } from "@base-ui/react/slider";

/**
 * The speaker glyph and the volume rail, at the right of the transport strip.
 *
 * Split out of `Transport` in phase 35 because the design puts the two at
 * opposite ends of the strip - and because the rail reports on every pointer
 * move, so anything sharing a component with it re-renders at that rate.
 *
 * The glyph is three ascending bars, the tallest at partial opacity, exactly as
 * the design draws it. It is not a button yet: making it toggle mute is phase
 * 38, which is also where the muted state it would need comes from.
 */
export function VolumeControl({
  volume,
  onVolumeChange,
}: {
  volume: number;
  onVolumeChange: (volume: number) => void;
}) {
  return (
    <div className="volume">
      <span className="volume-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>

      {/* `onValueChange`, unlike the scrubber's `onValueCommitted`: volume is
          meant to be heard as it moves, and setting it is a cheap write to the
          sink rather than a seek. */}
      <Slider.Root
        className="volume-slider"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onValueChange={(value) =>
          onVolumeChange((typeof value === "number" ? value : (value[0] ?? 0)) / 100)
        }
      >
        <Slider.Control className="volume-control">
          <Slider.Track className="volume-rail">
            <Slider.Indicator className="volume-fill" />
            {/* The design draws the rail with no knob on it. Keeping one that
                appears on hover or focus leaves the resting picture as drawn
                while still giving the control something to drag and something
                to put a focus ring around. */}
            <Slider.Thumb className="volume-thumb" aria-label="Volume" />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </div>
  );
}
