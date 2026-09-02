import { Slider } from "@base-ui/react/slider";
import { useEffect, useRef } from "react";
import { VOLUME_STEP } from "../../features/player/shortcuts";
import { Icon } from "../icons/Icon";

/**
 * The speaker glyph and the volume rail, at the right of the transport strip.
 *
 * Split out of `Transport` in phase 35 because the design puts the two at
 * opposite ends of the strip - and because the rail reports on every pointer
 * move, so anything sharing a component with it re-renders at that rate.
 *
 * The glyph is the speaker from the icon set. It was three ascending bars drawn
 * to the design, with a pseudo-element slash over them when muted; the icon
 * carries both states itself, and the button still greys, so muting says so
 * twice - colour and shape - as it did before. The rail beside it keeps showing
 * the level unmuting will come back to rather than dropping to zero.
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
  const wrapper = useRef<HTMLDivElement>(null);
  // Read through a ref so the listener below can be registered once. Volume
  // reports on every pointer move, and re-binding a DOM listener at that rate
  // is exactly the cost this component was split out to avoid.
  const latest = useRef({ volume, onVolumeChange });
  // Written after commit, not during render: a ref write in the render body is
  // a rules-of-React violation that makes React Compiler skip the component.
  // The only reader is the wheel handler, which cannot run before the commit
  // that would have updated the ref.
  useEffect(() => {
    latest.current = { volume, onVolumeChange };
  });

  useEffect(() => {
    const element = wrapper.current;
    if (element === null) {
      return;
    }
    // A listener rather than an `onWheel` prop: React attaches `wheel`
    // passively, so `preventDefault` inside the prop does nothing but log a
    // warning while the content behind the strip scrolls anyway.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      const { volume: current, onVolumeChange: report } = latest.current;
      const next = current + (event.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP);
      report(Math.max(0, Math.min(1, next)));
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  return (
    /* The muted state is on the wrapper rather than the button alone: it dims
       the rail's fill too, so the level on screen reads as the level that will
       come back rather than the level being heard. */
    <div className="volume" ref={wrapper} data-muted={muted ? "" : undefined}>
      <button
        type="button"
        className="volume-mark"
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        disabled={!onToggleMute}
        onClick={onToggleMute}
      >
        <Icon name={muted ? "volume-muted" : "volume"} size={17} />
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
