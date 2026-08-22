//! The three dominant colours of a cover, by splitting colour boxes.
//!
//! Pure: bytes in, three colours out. No database, no Tauri runtime, no
//! filesystem - which is what lets the whole algorithm be tested against
//! images built in memory.
//!
//! **Why here and not in the webview.** The bytes are already in hand at
//! cover-store time, the answer is wanted once per unique cover rather than
//! once per track change, and reading pixels back off a `cover://` image on a
//! canvas is a same-origin argument with the webview that this side never has
//! to have.
//!
//! **Why a box split, and where this differs from the plan.** The picture is
//! being reduced to three blurred blobs at under a tenth of full opacity, so
//! precision is not the point - the same cover producing the same three
//! colours every time is. `docs/PLAN-apex.md` phase 39 asked for median cut on
//! those grounds, and it is the wrong one of the two deterministic box splits
//! for this: median cut divides a box at its *median pixel*, so three boxes
//! hold a third of the pixels each. An album cover that is 70% near-black -
//! which is a great many of them - therefore spends two of its three boxes on
//! near-black and averages everything bright into the third. Two blobs the
//! same colour and one made of mud.
//!
//! Splitting at the *midpoint of the widest channel's range* instead divides by
//! colour rather than by population: the darks fall on one side, the accents on
//! the other, and the second split separates the accents. It is no less
//! deterministic and no slower. Boxes are then ordered by how many pixels they
//! hold, so the dominant colour still comes first.
//!
//! A near-greyscale cover produces near-greyscale blobs, which is the right
//! answer rather than a failure to find one.

use crate::model::Colour;

/// How many colours a palette holds. Three, because that is how many blobs the
/// background draws.
const COLOURS: usize = 3;

/// The longest edge a decoded cover is reduced to before it is counted.
///
/// Covers are commonly 1400x1400 or larger, which is two million pixels to
/// sort through for an answer that three blurred circles will express. At 64
/// the count is at most 4096 pixels and the extraction disappears into the
/// noise of the insert that follows it. Downsampling also does some of the
/// averaging the algorithm would otherwise have to.
const SAMPLE_EDGE: u32 = 64;

/// The three dominant colours of an encoded cover image.
///
/// `None` for bytes that are not an image this build can decode, or an image
/// with no pixels in it. A cover we cannot read is not an error worth failing
/// a scan over - it means no blobs behind that album, which is the same thing
/// as a track with no artwork at all.
pub fn extract(bytes: &[u8]) -> Option<Vec<Colour>> {
    let decoded = image::load_from_memory(bytes).ok()?;
    // Downscale only. `resize` scales in both directions, and enlarging a
    // cover that is already small blends its colours with a filter kernel
    // instead of counting them - a smaller image is not a less accurate
    // sample, it is a cheaper one.
    let sampled = if decoded.width() > SAMPLE_EDGE || decoded.height() > SAMPLE_EDGE {
        decoded.resize(
            SAMPLE_EDGE,
            SAMPLE_EDGE,
            image::imageops::FilterType::Triangle,
        )
    } else {
        decoded
    }
    .to_rgb8();

    let pixels: Vec<Colour> = sampled
        .pixels()
        .map(|p| Colour {
            r: p[0],
            g: p[1],
            b: p[2],
        })
        .collect();

    dominant(pixels)
}

/// The [`COLOURS`] dominant colours of a pixel set.
///
/// Split out from [`extract`] so the algorithm can be tested on pixels
/// directly, without an encoder in the way.
pub fn dominant(pixels: Vec<Colour>) -> Option<Vec<Colour>> {
    if pixels.is_empty() {
        return None;
    }

    let mut boxes = vec![pixels];
    // Each round takes the box that spans the most colour, not the most
    // pixels: a picture that is mostly one wash with two accents should give
    // up the accents rather than three shades of the wash.
    while boxes.len() < COLOURS {
        let Some(widest) = boxes
            .iter()
            .enumerate()
            // A range of zero is a box of one colour, however many pixels are
            // in it. There is nothing left in it to divide.
            .filter(|(_, box_)| longest_edge(box_).1 > 0)
            .max_by_key(|(_, box_)| longest_edge(box_).1)
            .map(|(index, _)| index)
        else {
            // Every box holds a single colour: an image with fewer than three
            // of them. Repeating what is there is the honest answer - three
            // blobs of one colour is what a monochrome cover looks like.
            break;
        };

        let box_ = boxes.swap_remove(widest);
        let (channel, _) = longest_edge(&box_);
        let mid = midpoint(&box_, channel);
        // Both sides are non-empty by construction: the range is above zero,
        // and `mid` sits at or above the minimum and strictly below the
        // maximum, so the darkest pixel lands low and the brightest high.
        let (low, high): (Vec<Colour>, Vec<Colour>) = box_
            .into_iter()
            .partition(|colour| channel.of(colour) <= mid);
        boxes.push(low);
        boxes.push(high);
    }

    // Most pixels first, so `palette[0]` is the colour the cover is mostly
    // made of and the blobs can be sized by prominence.
    boxes.sort_by_key(|box_| std::cmp::Reverse(box_.len()));

    let mut colours: Vec<Colour> = boxes.iter().map(|box_| mean(box_)).collect();
    // A cover with one or two distinct colours leaves fewer boxes than
    // COLOURS. The frontend is promised three, so the last one repeats.
    while colours.len() < COLOURS {
        let last = colours[colours.len() - 1];
        colours.push(last);
    }
    Some(colours)
}

/// Which channel varies most across a box, and by how much.
///
/// The range is compared raw rather than weighted for perception. The output
/// is three blurred washes at a tenth of opacity; a perceptual weighting would
/// change which of two nearly identical answers is picked and nothing a viewer
/// could see.
fn longest_edge(box_: &[Colour]) -> (Channel, u8) {
    [Channel::R, Channel::G, Channel::B]
        .into_iter()
        .map(|channel| {
            let values = box_.iter().map(|colour| channel.of(colour));
            let (min, max) = values.fold((u8::MAX, u8::MIN), |(min, max), value| {
                (min.min(value), max.max(value))
            });
            (channel, max - min)
        })
        .max_by_key(|&(_, range)| range)
        // Only reachable on an empty box, which the caller filters out.
        .unwrap_or((Channel::R, 0))
}

/// Halfway between a box's darkest and brightest value on `channel`.
///
/// The midpoint of the *range*, not the average of the values: an average is
/// pulled towards whichever cluster is larger, which would put the cut inside
/// that cluster and bring back the problem median cut has.
fn midpoint(box_: &[Colour], channel: Channel) -> u8 {
    let (min, max) = box_
        .iter()
        .map(|colour| channel.of(colour))
        .fold((u8::MAX, u8::MIN), |(min, max), value| {
            (min.min(value), max.max(value))
        });
    // Through u16: 255 + 255 does not fit in the type the channels are in.
    ((u16::from(min) + u16::from(max)) / 2) as u8
}

/// The average colour of a box, which is what it contributes to the palette.
fn mean(box_: &[Colour]) -> Colour {
    // u32 rather than u8: 4096 pixels at 255 overflows a u8 in the first
    // dozen, and a saturating add would quietly return white.
    let total = box_.iter().fold((0u32, 0u32, 0u32), |(r, g, b), colour| {
        (
            r + u32::from(colour.r),
            g + u32::from(colour.g),
            b + u32::from(colour.b),
        )
    });
    let count = box_.len() as u32;
    Colour {
        r: (total.0 / count) as u8,
        g: (total.1 / count) as u8,
        b: (total.2 / count) as u8,
    }
}

#[derive(Debug, Clone, Copy)]
enum Channel {
    R,
    G,
    B,
}

impl Channel {
    fn of(self, colour: &Colour) -> u8 {
        match self {
            Channel::R => colour.r,
            Channel::G => colour.g,
            Channel::B => colour.b,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgb(r: u8, g: u8, b: u8) -> Colour {
        Colour { r, g, b }
    }

    /// `colours` repeated into a pixel set, one run each.
    fn pixels(colours: &[(Colour, usize)]) -> Vec<Colour> {
        colours
            .iter()
            .flat_map(|&(colour, count)| std::iter::repeat_n(colour, count))
            .collect()
    }

    /// A PNG of `colours`, one pixel per column, encoded in memory.
    ///
    /// Generated rather than committed, like every other fixture in this
    /// repository: no binary blobs in git, and nothing to keep in step with
    /// the test that reads it.
    fn png(colours: &[Colour]) -> Vec<u8> {
        let width = colours.len() as u32;
        let mut buffer = image::RgbImage::new(width, 1);
        for (x, colour) in colours.iter().enumerate() {
            buffer.put_pixel(x as u32, 0, image::Rgb([colour.r, colour.g, colour.b]));
        }

        let mut encoded = Vec::new();
        image::DynamicImage::ImageRgb8(buffer)
            .write_to(
                &mut std::io::Cursor::new(&mut encoded),
                image::ImageFormat::Png,
            )
            .unwrap();
        encoded
    }

    #[test]
    fn three_clear_colours_come_back_as_themselves() {
        let found = dominant(pixels(&[
            (rgb(255, 0, 0), 10),
            (rgb(0, 255, 0), 10),
            (rgb(0, 0, 255), 10),
        ]))
        .unwrap();

        assert_eq!(found.len(), 3);
        // Order is by box size, and the three boxes are the same size, so this
        // asserts the set rather than the sequence.
        for colour in [rgb(255, 0, 0), rgb(0, 255, 0), rgb(0, 0, 255)] {
            assert!(found.contains(&colour), "{colour:?} missing from {found:?}");
        }
    }

    #[test]
    fn the_dominant_colour_comes_first() {
        let found = dominant(pixels(&[
            (rgb(0, 0, 255), 2),
            (rgb(0, 255, 0), 2),
            (rgb(255, 0, 0), 100),
        ]))
        .unwrap();

        assert_eq!(found[0], rgb(255, 0, 0));
    }

    #[test]
    fn a_cover_that_is_mostly_one_colour_does_not_spend_two_blobs_on_it() {
        // The case that decided the algorithm. A true median cut divides by
        // pixel count, so 70% near-black over two accents comes back as two
        // near-blacks and one average of the accents - two identical blobs and
        // one that is in neither picture. Splitting by colour range instead
        // keeps the black to one box and separates the accents.
        let found = dominant(pixels(&[
            (rgb(10, 10, 12), 70),
            (rgb(220, 40, 30), 20),
            (rgb(30, 90, 200), 10),
        ]))
        .unwrap();

        assert_eq!(found[0], rgb(10, 10, 12));
        // Three colours, and no two of them the same wash. The blobs are drawn
        // at under a tenth of opacity, so "distinct" is generous here - what
        // must not happen is two of them being the same value.
        for (index, colour) in found.iter().enumerate() {
            for other in &found[index + 1..] {
                let distance = colour.r.abs_diff(other.r) as u32
                    + colour.g.abs_diff(other.g) as u32
                    + colour.b.abs_diff(other.b) as u32;
                assert!(distance > 60, "{colour:?} and {other:?} are the same blob");
            }
        }
    }

    #[test]
    fn the_same_pixels_give_the_same_answer_every_time() {
        // The whole reason for median cut over anything with a random seed:
        // an album's background must not change between two plays of it.
        let input = pixels(&[
            (rgb(200, 30, 40), 7),
            (rgb(20, 90, 180), 5),
            (rgb(240, 230, 200), 3),
            (rgb(15, 15, 15), 11),
        ]);

        let first = dominant(input.clone()).unwrap();
        for _ in 0..5 {
            assert_eq!(dominant(input.clone()).unwrap(), first);
        }
    }

    #[test]
    fn a_monochrome_cover_gives_three_of_the_same_colour() {
        let found = dominant(pixels(&[(rgb(64, 64, 64), 20)])).unwrap();

        assert_eq!(found, vec![rgb(64, 64, 64); 3]);
    }

    #[test]
    fn a_near_greyscale_cover_stays_near_greyscale() {
        // The design's own sample data is exactly this case, and the temptation
        // is to "fix" it by saturating. A grey record has a grey background.
        let found = dominant(pixels(&[
            (rgb(64, 64, 64), 10),
            (rgb(112, 96, 96), 10),
            (rgb(224, 224, 224), 10),
        ]))
        .unwrap();

        for colour in &found {
            let spread = colour.r.abs_diff(colour.b);
            assert!(spread < 32, "{colour:?} is more saturated than its source");
        }
    }

    #[test]
    fn two_distinct_colours_fill_the_third_slot() {
        let found = dominant(pixels(&[(rgb(0, 0, 0), 5), (rgb(255, 255, 255), 5)])).unwrap();

        assert_eq!(found.len(), 3);
        assert_eq!(found[1], found[2]);
    }

    #[test]
    fn no_pixels_means_no_palette() {
        assert!(dominant(Vec::new()).is_none());
    }

    #[test]
    fn a_real_encoded_image_is_decoded_and_reduced() {
        let found = extract(&png(&[rgb(255, 0, 0), rgb(0, 255, 0), rgb(0, 0, 255)])).unwrap();

        assert_eq!(found.len(), 3);
        // Three pixels survive the resize untouched - the sample edge is well
        // above three - so the decode path gives back what went in.
        for colour in [rgb(255, 0, 0), rgb(0, 255, 0), rgb(0, 0, 255)] {
            assert!(found.contains(&colour), "{colour:?} missing from {found:?}");
        }
    }

    #[test]
    fn a_large_image_is_sampled_rather_than_counted_whole() {
        // 512 columns cycling through four colours. What matters is that it
        // comes back at all: the resize is on the path, and an off-by-one in
        // the filter arguments would either panic or return an empty buffer.
        let ramp: Vec<Colour> = (0..512u32)
            .map(|x| match x % 4 {
                0 => rgb(255, 0, 0),
                1 => rgb(0, 255, 0),
                2 => rgb(0, 0, 255),
                _ => rgb(0, 0, 0),
            })
            .collect();

        assert_eq!(extract(&png(&ramp)).unwrap().len(), 3);
    }

    #[test]
    fn bytes_that_are_not_an_image_have_no_palette() {
        // `e2e/fixtures.ts` writes a file called `cover.jpg` whose contents are
        // the words "not an image", precisely so something exercises this.
        assert!(extract(b"not an image").is_none());
    }
}
