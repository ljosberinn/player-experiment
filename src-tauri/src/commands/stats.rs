//! The Statistics view's reads, one command per aggregate in `db::stats`.
//!
//! Every one runs off the IPC thread: an aggregate over a whole listening
//! history reads every play, and that is not work for the thread that paints
//! the window.

use rusqlite::Connection;
use tauri::Manager;

use super::{blocking, op};
use crate::db::{stats, Db};
use crate::error::AppResult;
use crate::model::{
    AlbumBitrate, GenreBreakdown, HistogramBin, HistogramField, LibraryTotals, ListenDimension,
    ListenQuery, ListenTotals, Play, Streaks, TagHealth, TimeBucket, TimeCount, TopEntry,
    TrackQuery,
};

async fn read<T: Send + 'static>(
    app: tauri::AppHandle,
    name: &'static str,
    work: impl FnOnce(&Connection) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let op = op(&app, name).quiet();
    blocking(name, move || op.run(|| work(&app.state::<Db>().conn()?))).await
}

#[tauri::command]
pub async fn stats_listen_totals(
    app: tauri::AppHandle,
    query: ListenQuery,
) -> AppResult<ListenTotals> {
    read(app, "stats.listen_totals", move |conn| {
        stats::listen_totals(conn, &query)
    })
    .await
}

#[tauri::command]
pub async fn stats_recent_plays(
    app: tauri::AppHandle,
    query: ListenQuery,
    offset: u32,
    limit: u32,
) -> AppResult<Vec<Play>> {
    read(app, "stats.recent_plays", move |conn| {
        stats::recent_plays(conn, &query, offset, limit)
    })
    .await
}

#[tauri::command]
pub async fn stats_top(
    app: tauri::AppHandle,
    query: ListenQuery,
    dimension: ListenDimension,
    limit: u32,
) -> AppResult<Vec<TopEntry>> {
    read(app, "stats.top", move |conn| {
        stats::top(conn, &query, dimension, limit)
    })
    .await
}

#[tauri::command]
pub async fn stats_plays_over_time(
    app: tauri::AppHandle,
    query: ListenQuery,
    bucket: TimeBucket,
) -> AppResult<Vec<TimeCount>> {
    read(app, "stats.plays_over_time", move |conn| {
        stats::plays_over_time(conn, &query, bucket)
    })
    .await
}

#[tauri::command]
pub async fn stats_week_clock(app: tauri::AppHandle, query: ListenQuery) -> AppResult<Vec<u32>> {
    read(app, "stats.week_clock", move |conn| {
        stats::week_clock(conn, &query)
    })
    .await
}

#[tauri::command]
pub async fn stats_firsts(
    app: tauri::AppHandle,
    query: ListenQuery,
    bucket: TimeBucket,
) -> AppResult<Vec<TimeCount>> {
    read(app, "stats.firsts", move |conn| {
        stats::firsts(conn, &query, bucket)
    })
    .await
}

#[tauri::command]
pub async fn stats_streaks(app: tauri::AppHandle, query: ListenQuery) -> AppResult<Streaks> {
    read(app, "stats.streaks", move |conn| {
        stats::streaks(conn, &query, crate::now_seconds())
    })
    .await
}

#[tauri::command]
pub async fn stats_library_totals(
    app: tauri::AppHandle,
    query: TrackQuery,
) -> AppResult<LibraryTotals> {
    read(app, "stats.library_totals", move |conn| {
        stats::library_totals(conn, &query)
    })
    .await
}

#[tauri::command]
pub async fn stats_histogram(
    app: tauri::AppHandle,
    query: TrackQuery,
    field: HistogramField,
) -> AppResult<Vec<HistogramBin>> {
    read(app, "stats.histogram", move |conn| {
        stats::histogram(conn, &query, field)
    })
    .await
}

#[tauri::command]
pub async fn stats_worst_by_bitrate(
    app: tauri::AppHandle,
    query: TrackQuery,
    limit: u32,
) -> AppResult<Vec<AlbumBitrate>> {
    read(app, "stats.worst_by_bitrate", move |conn| {
        stats::worst_by_bitrate(conn, &query, limit)
    })
    .await
}

#[tauri::command]
pub async fn stats_genre_breakdown(
    app: tauri::AppHandle,
    query: TrackQuery,
    parent: Option<String>,
) -> AppResult<GenreBreakdown> {
    read(app, "stats.genre_breakdown", move |conn| {
        stats::genre_breakdown(conn, &query, parent.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn stats_added_over_time(
    app: tauri::AppHandle,
    query: TrackQuery,
    bucket: TimeBucket,
) -> AppResult<Vec<TimeCount>> {
    read(app, "stats.added_over_time", move |conn| {
        stats::added_over_time(conn, &query, bucket)
    })
    .await
}

#[tauri::command]
pub async fn stats_tag_health(app: tauri::AppHandle, query: TrackQuery) -> AppResult<TagHealth> {
    read(app, "stats.tag_health", move |conn| {
        stats::tag_health(conn, &query)
    })
    .await
}
