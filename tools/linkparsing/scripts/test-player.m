// Exercise the real native player lifecycle with synthetic files, not a browser mock.
#define main linkparsing_application_main
#import "../macos/App.m"
#undef main
@interface LPPlayerTest : LPDelegate
@property(strong) NSDictionary *result;
@end
@implementation LPPlayerTest
- (void)reply:(NSDictionary *)reply { self.result = reply; }
@end
static BOOL waitFor(LPPlayerTest *host) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:25];
    while (!host.result && deadline.timeIntervalSinceNow > 0)
        [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
    return [host.result[@"ok"] boolValue];
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) return 2;
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
        LPPlayerTest *host = [LPPlayerTest new];
        host.activeAsset = @1;
        [host showPlayer:[NSString stringWithUTF8String:argv[1]] identifier:@1 converted:YES];
        AVPlayerItemVideoOutput *output = [[AVPlayerItemVideoOutput alloc] initWithPixelBufferAttributes:nil];
        [host.playerView.player.currentItem addOutput:output];
        if (!waitFor(host) || ![host.viewedAsset isEqual:@1]) return 3;
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:10];
        BOOL decoded = NO;
        while (!decoded && deadline.timeIntervalSinceNow > 0) {
            [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
            CVPixelBufferRef frame = [output copyPixelBufferForItemTime:host.playerView.player.currentTime itemTimeForDisplay:NULL];
            if (frame) { decoded = YES; CVPixelBufferRelease(frame); }
        }
        if (!decoded) return 4;
        [host.playerWindow close];
        if (host.playerView.player.rate != 0 || host.observedItem) return 6;
        host.result = nil;
        [host showPlayer:@"/nonexistent-linkparsing-test.mp4" identifier:@2 converted:NO];
        if (waitFor(host) || host.viewedAsset || !host.result) return 5;
        [host stopObservingPlayer];
        [host.playerView.player pause];
        [host.playerWindow close];
        puts("PASS: native AVPlayer ready, automatic playback, decoded video frame, missing-file failure, review gate reset, close pauses playback.");
    }
    return 0;
}
