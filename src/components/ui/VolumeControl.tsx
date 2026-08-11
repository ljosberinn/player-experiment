import { Slider } from "@base-ui/react/slider";

/**
 * The speaker glyph and the volume rail, at the right of the transport strip.
 *
 * Split out of `Transport` in phase 35 because the design puts the two at
 * opposite ends of the strip - and because the rail reports on every pointer
 * move, so anything sharing a component with it re-renders at that rate.
 *
 * The glyph is three ascending bars, the tallest at partial opacity, exactly as
 * the design draws it. Since phase 38 it is also the mute button: the bars go
 * grey and a slash crosses them, and the rail beside it keeps showing the level
 * unmuting will come back to rather than dropping to zero.
 *
 * `aria-pressed` rather than two different buttons, because it is one control
 * in two states - and the label says what pressing it does now, which is what a
 * screen reader announces after the state.
 */
export function VolumeControl({
  volume,
  muted = false,
  onVolumeChange,
  onToggleMute,
}: {
  volume: number;
  muted?: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute?: () => void;
}) {
  return (
    /* The muted state is on the wrapper rather than the button alone: it dims
       the rail's fill too, so the level on screen reads as the level that will
       come back rather than the level being heard. */
    <div className="volume" data-muted={muted ? "" : undefined}>
      <button
        type="button"
        className="volume-mark"
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        disabled={!onToggleMute}
        onClick={onToggleMute}
      >
        <i />
        <i />
        <i />
      </button>

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
            {/* The design draws the rail with no knob. This one has the same
                knob the playhead does, deliberately: a handle that is
                invisible until focused measured 1.44:1 against the strip, and
                WCAG 1.4.11 asks 3:1 of the parts of a control needed to
                understand it. See `.volume-thumb` in App.css. */}
            <Slider.Thumb className="volume-thumb" aria-label="Volume" />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </div>
  );
}
