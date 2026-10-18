use glib::prelude::*;

#[test]
fn string_array_iteration_is_sound_in_both_directions() {
    let variant = ["alpha", "βeta", "", "omega"].to_variant();
    let mut iter = variant.array_iter_str().unwrap();
    assert_eq!(iter.next(), Some("alpha"));
    assert_eq!(iter.next_back(), Some("omega"));
    assert_eq!(iter.next(), Some("βeta"));
    assert_eq!(iter.next_back(), Some(""));
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
}
