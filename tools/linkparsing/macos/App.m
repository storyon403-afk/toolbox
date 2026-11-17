#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <AVKit/AVKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
static int LPTestExitStatus = 0;

@interface LPDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSWindowDelegate>
@property(strong) NSWindow *window;
@property(strong) NSURL *managedData;
@property(strong) NSMutableDictionary *managedPreferences;
@property BOOL managedReady;
@property(strong) WKWebView *web;
@property(strong) NSTask *worker;
@property(strong) NSPipe *input;
@property(strong) NSMutableData *buffer;
@property(strong) NSMutableDictionary<NSNumber *, NSString *> *pending;
@property(strong) NSURL *page;
@property(strong) NSURL *workspace;
@property(strong) NSURL *cookies;
@property(strong) NSURL *lastExport;
@property(strong) NSURL *sourceFolder;
@property(strong) NSURL *importURL;
@property(strong) NSWindow *playerWindow;
@property(strong) AVPlayerView *playerView;
@property(strong) AVPlayerItem *observedItem;
@property(strong) NSNumber *playerRequest;
@property(strong) NSNumber *activeAsset;
@property(strong) NSNumber *viewedAsset;
@property BOOL quitting;
@property BOOL workerFailed;
@property BOOL selfTestStarted;
@end

@implementation LPDelegate
- (id)preference:(NSString *)key {
    return self.managedData ? self.managedPreferences[key] : [NSUserDefaults.standardUserDefaults objectForKey:key];
}
- (void)setPreference:(id)value forKey:(NSString *)key {
    if (!self.managedData) { [NSUserDefaults.standardUserDefaults setObject:value forKey:key]; return; }
    self.managedPreferences[key] = value;
    [self.managedPreferences writeToURL:[self.managedData URLByAppendingPathComponent:@"preferences.plist"] atomically:YES];
}

- (void)reply:(NSDictionary *)reply {
    [self.web callAsyncJavaScript:@"window.desktopReply(reply)" arguments:@{@"reply":reply}
        inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:nil];
}
- (void)success:(NSNumber *)identifier data:(NSDictionary *)data {
    [self reply:@{@"id":identifier,@"ok":@YES,@"data":data}];
}
- (void)failure:(NSNumber *)identifier message:(NSString *)message {
    [self reply:@{@"id":identifier,@"ok":@NO,@"error":@{@"code":@"native_error",@"message":message}}];
}
- (void)send:(NSDictionary *)command identifier:(NSNumber *)identifier action:(NSString *)action {
    if (!self.worker.running || self.workerFailed) {
        [self failure:identifier message:@"后端未启动或已退出。请退出应用后重新打开，并检查 FFmpeg 依赖。"];
        return;
    }
    self.pending[identifier] = action;
    NSData *json = [NSJSONSerialization dataWithJSONObject:@{@"id":identifier,@"command":command} options:0 error:nil];
    NSMutableData *line = [json mutableCopy];
    [line appendBytes:"\n" length:1];
    NSError *error = nil;
    if (![self.input.fileHandleForWriting writeData:line error:&error]) {
        [self.pending removeObjectForKey:identifier];
        [self failure:identifier message:@"后端连接已断开，请重新启动应用。"];
    }
}
- (void)stopObservingPlayer {
    if (self.observedItem) [self.observedItem removeObserver:self forKeyPath:@"status"];
    self.observedItem = nil;
}
- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
    (void)keyPath; (void)change; (void)context;
    dispatch_async(dispatch_get_main_queue(), ^{
        if (object != self.observedItem) return;
        AVPlayerItem *item = object;
        if (item.status == AVPlayerItemStatusReadyToPlay) {
            self.viewedAsset = self.activeAsset;
            [self.playerView.player play];
            if (self.playerRequest) [self success:self.playerRequest data:@{@"opened":@YES}];
            self.playerRequest = nil;
        } else if (item.status == AVPlayerItemStatusFailed) {
            NSNumber *identifier = self.playerRequest;
            self.playerRequest = nil;
            self.viewedAsset = nil;
            [self.playerView.player pause];
            [self.playerWindow close];
            [self stopObservingPlayer];
            if (identifier) [self failure:identifier message:@"播放器无法读取该素材。请点击文件夹按钮定位源文件，使用其他本地播放器查看。"];
            else {
                NSAlert *alert = [NSAlert new];
                alert.messageText = @"素材播放失败";
                alert.informativeText = @"请点击提取页的文件夹按钮，使用其他本地播放器查看源文件。";
                [alert beginSheetModalForWindow:self.window completionHandler:nil];
            }
        }
    });
}
- (void)showPlayer:(NSString *)path identifier:(NSNumber *)identifier converted:(BOOL)converted {
    [self stopObservingPlayer];
    self.viewedAsset = nil;
    [self.playerView.player pause];
    [self.playerWindow close];
    self.playerRequest = identifier;
    self.playerWindow = [[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,900,580)
        styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskResizable
        backing:NSBackingStoreBuffered defer:NO];
    self.playerWindow.title = converted ? @"完整素材 · 兼容播放副本（原文件未修改）" : @"查看完整源素材 · 请人工检查水印";
    self.playerWindow.releasedWhenClosed = NO;
    self.playerWindow.delegate = self;
    self.playerView = [[AVPlayerView alloc] initWithFrame:self.playerWindow.contentView.bounds];
    self.playerView.autoresizingMask = NSViewWidthSizable|NSViewHeightSizable;
    self.playerView.controlsStyle = AVPlayerViewControlsStyleFloating;
    self.playerView.player = [AVPlayer playerWithURL:[NSURL fileURLWithPath:path]];
    self.playerWindow.contentView = self.playerView;
    [self.playerWindow center];
    [self.playerWindow makeKeyAndOrderFront:nil];
    // Only an explicit preview action starts playback, after the item is ready.
    self.observedItem = self.playerView.player.currentItem;
    [self.observedItem addObserver:self forKeyPath:@"status" options:NSKeyValueObservingOptionInitial|NSKeyValueObservingOptionNew context:NULL];
    AVPlayerItem *expected = self.observedItem;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (self.observedItem != expected || !self.playerRequest) return;
        NSNumber *request = self.playerRequest;
        self.playerRequest = nil;
        [self stopObservingPlayer];
        [self.playerView.player pause];
        [self.playerWindow close];
        [self failure:request message:@"播放器加载超时。请重新尝试，或通过文件夹按钮打开源文件。"];
    });
}
- (void)windowWillClose:(NSNotification *)notification {
    if (notification.object != self.playerWindow) return;
    [self.playerView.player pause];
    [self stopObservingPlayer];
    if (self.playerRequest) [self success:self.playerRequest data:@{@"cancelled":@YES}];
    self.playerRequest = nil;
}
- (void)received:(NSDictionary *)raw {
    NSNumber *identifier = raw[@"id"];
    NSString *action = self.pending[identifier];
    if (!action) return;
    if ([raw[@"event"] isEqual:@"progress"]) { [self reply:raw]; return; }
    [self.pending removeObjectForKey:identifier];
    NSMutableDictionary *reply = [raw mutableCopy];
    if ([raw[@"ok"] boolValue] && [raw[@"data"] isKindOfClass:NSDictionary.class]) {
        NSMutableDictionary *data = [raw[@"data"] mutableCopy];
        if ([action isEqual:@"doctor"] && !self.managedReady) {
            NSString *token = NSProcessInfo.processInfo.environment[@"TOOLBOX_READY_TOKEN"];
            if (token && [data[@"download_ready"] boolValue]) {
                self.managedReady = YES;
                NSData *ready = [NSJSONSerialization dataWithJSONObject:@{@"toolboxReady":token,@"dataDir":self.managedData.path ?: @"",@"doctor":data} options:0 error:nil];
                [NSFileHandle.fileHandleWithStandardOutput writeData:ready];
                [NSFileHandle.fileHandleWithStandardOutput writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
            }
        }
        if ([action isEqual:@"doctor"]) data[@"preferences"] = @{
            @"public_dns":@([[self preference:@"LPPublicDNS"] boolValue]),
            @"workspace":self.workspace.path ?: @"未选择"};
        if ([action isEqual:@"import"] || [action isEqual:@"download"] || [action isEqual:@"resolve"])
            data[@"workspace"] = self.workspace.path ?: @"未选择";
        NSDictionary *asset = data[@"asset"];
        if (asset) {
            NSNumber *newAsset = asset[@"id"];
            if (![newAsset isEqual:self.activeAsset]) {
                [self stopObservingPlayer];
                [self.playerView.player pause];
                [self.playerWindow close];
                self.viewedAsset = nil;
                self.lastExport = nil;
                self.sourceFolder = nil;
            }
            self.activeAsset = newAsset;
            if ([action isEqual:@"import"]) self.sourceFolder = self.importURL.URLByDeletingLastPathComponent;
        }
        if ([data[@"source_directory"] isKindOfClass:NSString.class]) self.sourceFolder = [NSURL fileURLWithPath:data[@"source_directory"]];
        [data removeObjectForKey:@"source_directory"];
        NSString *path = data[@"preview_path"];
        if (path) {
            [self showPlayer:path identifier:identifier converted:[data[@"playback_copy"] boolValue]];
            return;
        }
        NSDictionary *report = data[@"report"];
        if (report) {
            id directory = report[@"directory"];
            self.lastExport = [directory isKindOfClass:NSString.class] ? [NSURL fileURLWithPath:directory] : nil;
            NSMutableDictionary *safe = [report mutableCopy];
            [safe removeObjectForKey:@"directory"];
            NSMutableArray *outputs = [NSMutableArray new];
            for (NSDictionary *output in report[@"outputs"]) {
                NSMutableDictionary *item = [output mutableCopy];
                if (output[@"files"]) {
                    NSMutableArray *names = [NSMutableArray new];
                    for (NSString *file in output[@"files"]) [names addObject:file.lastPathComponent];
                    item[@"files"] = names;
                }
                [outputs addObject:item];
            }
            safe[@"outputs"] = outputs;
            safe[@"can_reveal"] = @(self.lastExport != nil);
            data[@"report"] = safe;
        }
        reply[@"data"] = data;
    }
    [self reply:reply];
    NSArray *arguments = NSProcessInfo.processInfo.arguments;
    if ([action isEqual:@"doctor"] && !self.selfTestStarted && arguments.count == 4 && [arguments[1] isEqual:@"--self-test"]) {
        self.selfTestStarted = YES;
        NSString *script = [NSString stringWithContentsOfFile:arguments[3] encoding:NSUTF8StringEncoding error:nil];
        if (!script) { LPTestExitStatus = 1; [NSApp terminate:nil]; return; }
        [self.web callAsyncJavaScript:script arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id value, NSError *error) {
            LPTestExitStatus = error ? 1 : 0;
            printf("%s: %s\n", error ? "FAIL" : "PASS", (error.localizedDescription ?: [value description]).UTF8String);
            fflush(stdout);
            [NSApp terminate:nil];
        }];
    }
}
- (void)startWorker {
    NSString *managed = NSProcessInfo.processInfo.environment[@"TOOLBOX_DATA_DIR"];
    NSArray *arguments = NSProcessInfo.processInfo.arguments;
    if (arguments.count == 4 && [arguments[1] isEqual:@"--self-test"]) managed = arguments[2];
    if (managed) {
        self.managedData = [NSURL fileURLWithPath:managed isDirectory:YES];
        self.managedPreferences = [[NSDictionary dictionaryWithContentsOfURL:[self.managedData URLByAppendingPathComponent:@"preferences.plist"]] mutableCopy] ?: [NSMutableDictionary new];
        NSString *saved = [self preference:@"LPWorkspace"];
        self.workspace = saved ? [NSURL fileURLWithPath:saved] : [self.managedData URLByAppendingPathComponent:@"workspace" isDirectory:YES];
        [NSFileManager.defaultManager createDirectoryAtURL:self.workspace withIntermediateDirectories:YES attributes:nil error:nil];
    }
    if (NSProcessInfo.processInfo.environment[@"TOOLBOX_READY_TOKEN"]) {
        NSFileHandle.fileHandleWithStandardInput.readabilityHandler = ^(NSFileHandle *handle) {
            if (!handle.availableData.length) { handle.readabilityHandler = nil; dispatch_async(dispatch_get_main_queue(), ^{ [NSApp terminate:nil]; }); }
        };
    }
    self.buffer = [NSMutableData new];
    self.pending = [NSMutableDictionary new];
    self.worker = [NSTask new];
    NSBundle *bundle = NSBundle.mainBundle;
    self.worker.executableURL = [bundle.executableURL.URLByDeletingLastPathComponent URLByAppendingPathComponent:@"linkparsing-desktop"];
    NSDictionary *runtime = [NSDictionary dictionaryWithContentsOfURL:[bundle URLForResource:@"Runtime" withExtension:@"plist"]];
    NSString *(^resource)(NSString *) = ^NSString *(NSString *key) {
        NSString *value = runtime[key] ?: @"";
        return value.length && !value.isAbsolutePath ? [bundle.resourcePath stringByAppendingPathComponent:value] : value;
    };
    self.worker.environment = @{@"PATH":@"/usr/bin:/bin",@"LANG":@"en_US.UTF-8",
        @"LINKPARSING_OCR":[bundle.executableURL.URLByDeletingLastPathComponent URLByAppendingPathComponent:@"linkparsing-ocr"].path,
        @"LINKPARSING_WHISPER":resource(@"Whisper"),@"LINKPARSING_ASR_MODEL":resource(@"ASRModel"),
        @"LINKPARSING_FFMPEG":resource(@"FFmpeg"),@"LINKPARSING_FFPROBE":resource(@"FFprobe"),@"LINKPARSING_NODE":resource(@"Node"),
        @"LINKPARSING_PYTHON":resource(@"Python"),@"LINKPARSING_WORKER":[bundle URLForResource:@"download" withExtension:@"py" subdirectory:@"Worker"].path ?: @""};
    self.input = [NSPipe pipe];
    NSPipe *output = [NSPipe pipe];
    self.worker.standardInput = self.input;
    self.worker.standardOutput = output;
    self.worker.standardError = NSFileHandle.fileHandleWithNullDevice;
    __weak LPDelegate *weakSelf = self;
    output.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
        NSData *chunk = handle.availableData;
        if (!chunk.length) { handle.readabilityHandler = nil; return; }
        dispatch_async(dispatch_get_main_queue(), ^{
            LPDelegate *owner = weakSelf;
            if (!owner) return;
            [owner.buffer appendData:chunk];
            if (owner.buffer.length > 1024*1024) { [owner.worker terminate]; return; }
            while (YES) {
                NSRange newline = [owner.buffer rangeOfData:[NSData dataWithBytes:"\n" length:1] options:0 range:NSMakeRange(0,owner.buffer.length)];
                if (newline.location == NSNotFound) break;
                NSData *line = [owner.buffer subdataWithRange:NSMakeRange(0,newline.location)];
                [owner.buffer replaceBytesInRange:NSMakeRange(0,newline.location+1) withBytes:NULL length:0];
                id value = [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
                if ([value isKindOfClass:NSDictionary.class]) [owner received:value];
            }
        });
    };
    self.worker.terminationHandler = ^(NSTask *task) {
        (void)task;
        // NSTerminateLater runs a nested event loop. A main-queue callback cannot
        // drain if terminate: was itself entered from that queue (managed EOF).
        CFRunLoopPerformBlock(CFRunLoopGetMain(), kCFRunLoopCommonModes, ^{
            LPDelegate *owner = weakSelf;
            owner.workerFailed = YES;
            if (owner.quitting) { [NSApp replyToApplicationShouldTerminate:YES]; return; }
            for (NSNumber *identifier in owner.pending.allKeys) [owner failure:identifier message:@"后端已退出。请重新启动应用；已导出的文件会保留。"];
            [owner.pending removeAllObjects];
            [owner.web callAsyncJavaScript:@"window.backendExited()" arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:nil];
        });
        CFRunLoopWakeUp(CFRunLoopGetMain());
    };
    NSError *error = nil;
    if (![self.worker launchAndReturnError:&error]) self.workerFailed = YES;
}
- (NSURL *)pickDirectory:(NSString *)title initial:(NSURL *)initial {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.title = title;
    panel.prompt = @"选择";
    panel.canChooseFiles = NO;
    panel.canChooseDirectories = YES;
    panel.canCreateDirectories = YES;
    panel.allowsMultipleSelection = NO;
    panel.directoryURL = initial;
    return [panel runModal] == NSModalResponseOK ? panel.URL : nil;
}
- (BOOL)ensureWorkspace {
    if (self.workspace && [self.workspace checkResourceIsReachableAndReturnError:nil]) return YES;
    self.workspace = [self pickDirectory:@"选择素材保存目录" initial:nil];
    if (self.workspace) [self setPreference:self.workspace.path forKey:@"LPWorkspace"];
    return self.workspace != nil;
}
- (NSURL *)pickFile:(NSString *)title types:(NSArray<UTType *> *)types {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.title = title;
    panel.allowedContentTypes = types;
    panel.canChooseDirectories = NO;
    panel.allowsMultipleSelection = NO;
    return [panel runModal] == NSModalResponseOK ? panel.URL : nil;
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    (void)controller;
    if (!message.frameInfo.mainFrame || ![message.frameInfo.request.URL isEqual:self.page] ||
        ![message.body isKindOfClass:NSDictionary.class]) return;
    NSDictionary *body = message.body;
    NSNumber *identifier = body[@"id"];
    NSString *action = body[@"action"];
    if (![identifier isKindOfClass:NSNumber.class] || identifier.longLongValue <= 0 ||
        ![action isKindOfClass:NSString.class] || self.pending[identifier]) return;
    if (self.pending.count && ![action isEqual:@"cancel"]) { [self failure:identifier message:@"请等待当前任务完成，或先取消。 "]; return; }
    if ([action isEqual:@"cancel"] && self.playerRequest) {
        [self.playerWindow close];
        [self success:identifier data:@{@"cancelled":@YES}]; return;
    }
    if ([action isEqual:@"doctor"] || [action isEqual:@"cancel"]) {
        [self send:@{@"type":action} identifier:identifier action:action]; return;
    }
    if ([action isEqual:@"workspace"]) {
        NSURL *picked = [self pickDirectory:@"选择素材保存目录" initial:self.workspace];
        if (picked) {
            self.workspace = picked;
            [self setPreference:picked.path forKey:@"LPWorkspace"];
        }
        [self success:identifier data:@{@"cancelled":@(picked == nil),@"workspace":self.workspace.path ?: @"未选择"}]; return;
    }
    if ([action isEqual:@"preferences"]) {
        BOOL enabled = [body[@"public_dns"] isEqual:@YES];
        [self setPreference:@(enabled) forKey:@"LPPublicDNS"];
        [self success:identifier data:@{@"public_dns":@(enabled)}]; return;
    }
    if ([action isEqual:@"cookies"]) {
        NSURL *picked = [self pickFile:@"选择主动提供的 Netscape Cookie 文件" types:@[UTTypePlainText]];
        if (picked) self.cookies = picked;
        [self success:identifier data:@{@"cancelled":@(picked == nil),@"cookie_name":self.cookies.lastPathComponent ?: @"未选择"}]; return;
    }
    if ([action isEqual:@"clear_cookies"]) { self.cookies = nil; [self success:identifier data:@{@"cookie_name":@"未选择"}]; return; }
    if ([action isEqual:@"reveal"]) {
        if (self.lastExport) { [NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[self.lastExport]]; [self success:identifier data:@{}]; }
        else [self failure:identifier message:@"尚无已完成的导出文件。"];
        return;
    }
    if ([action isEqual:@"reveal_source"]) {
        if (self.sourceFolder) { [NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[self.sourceFolder]]; [self success:identifier data:@{}]; }
        else [self failure:identifier message:@"尚未导入源素材。"];
        return;
    }
    if ([action isEqual:@"import"] || [action isEqual:@"download"] || [action isEqual:@"resolve"]) {
        if (![self ensureWorkspace]) { [self success:identifier data:@{@"cancelled":@YES}]; return; }
        if ([action isEqual:@"import"]) {
            NSURL *file = [self pickFile:@"导入本地视频或音频" types:@[UTTypeMovie,UTTypeAudio]];
            if (!file) { [self success:identifier data:@{@"cancelled":@YES}]; return; }
            self.importURL = file;
            [self send:@{@"type":@"import",@"path":file.path,@"workspace":self.workspace.path} identifier:identifier action:action];
        } else {
            NSString *share = body[@"share"];
            if (![share isKindOfClass:NSString.class] || [share lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 16384) {
                [self failure:identifier message:@"分享链接为空或过长。 "]; return;
            }
            [self send:@{@"type":action,@"share":share,@"workspace":self.workspace.path,
                @"cookies":self.cookies.path ?: NSNull.null,@"public_dns":@([body[@"public_dns"] isEqual:@YES])}
                identifier:identifier action:action];
        }
        return;
    }
    if ([action isEqual:@"reopen"]) {
        NSURL *folder = [self pickDirectory:@"打开包含 asset.json 的 download-* 素材目录" initial:self.workspace];
        if (!folder) { [self success:identifier data:@{@"cancelled":@YES}]; return; }
        [self send:@{@"type":@"reopen",@"directory":folder.path} identifier:identifier action:action]; return;
    }
    if (!self.activeAsset || ![body[@"asset_id"] isEqual:self.activeAsset]) {
        [self failure:identifier message:@"请先下载或导入素材。 "]; return;
    }
    if ([action isEqual:@"preview"]) {
        [self send:@{@"type":@"preview",@"asset_id":self.activeAsset,@"playback":@YES} identifier:identifier action:action]; return;
    }
    if ([action isEqual:@"ocr"]) {
        NSNumber *interval = body[@"interval_ms"];
        NSString *language = body[@"language"];
        if (![interval isKindOfClass:NSNumber.class] || interval.longLongValue < 1000 || interval.longLongValue > 3600000 || ![@[@"zh",@"en",@"ja",@"ko"] containsObject:language ?: @""]) {
            [self failure:identifier message:@"OCR 参数无效。 "]; return;
        }
        [self send:@{@"type":@"ocr",@"asset_id":self.activeAsset,@"range":body[@"range"] ?: NSNull.null,@"interval_ms":interval,@"language":language} identifier:identifier action:action]; return;
    }
    if ([action isEqual:@"transcribe"]) {
        NSString *language = body[@"language"];
        if (![@[@"auto",@"zh",@"en",@"ja",@"ko"] containsObject:language ?: @""]) {
            [self failure:identifier message:@"请选择支持的识别语言。 "]; return;
        }
        [self send:@{@"type":@"transcribe",@"asset_id":self.activeAsset,@"language":language}
            identifier:identifier action:action]; return;
    }
    if ([action isEqual:@"content"]) {
        NSNumber *offset = body[@"offset"];
        if (![offset isKindOfClass:NSNumber.class] || offset.longLongValue < 0 || offset.longLongValue > 50000) {
            [self failure:identifier message:@"文字页码无效。 "]; return;
        }
        [self send:@{@"type":@"content",@"asset_id":self.activeAsset,@"offset":offset,@"text_source":[body[@"text_source"] isEqual:@"ocr"] ? @"ocr" : @"speech"} identifier:identifier action:action]; return;
    }
    if ([action isEqual:@"review"]) {
        if (![self.viewedAsset isEqual:self.activeAsset]) {
            [self failure:identifier message:@"请先点击“播放源素材”，实际查看完整视频后再审核。 "]; return;
        }
        NSAlert *alert = [NSAlert new];
        alert.messageText = @"人工审核源素材";
        alert.informativeText = @"请在实际查看完整源素材后作出结论。确认无水印将允许画面与完整原视频导出；这不是自动检测或去水印。审核仅对当前会话中的素材有效。";
        [alert addButtonWithTitle:@"取消"];
        [alert addButtonWithTitle:@"确认无水印"];
        [alert addButtonWithTitle:@"发现水印"];
        NSTextField *note = [[NSTextField alloc] initWithFrame:NSMakeRect(0,0,420,48)];
        note.placeholderString = @"填写审核依据（必填，最多 500 字节）";
        alert.accessoryView = note;
        NSModalResponse choice = [alert runModal];
        if (choice == NSAlertFirstButtonReturn) { [self success:identifier data:@{@"cancelled":@YES}]; return; }
        NSString *text = [note.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if (!text.length || [text lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 500) {
            [self failure:identifier message:@"审核未保存：请填写有效的审核依据。 "]; return;
        }
        [self send:@{@"type":@"review",@"asset_id":self.activeAsset,@"clean":@(choice == NSAlertSecondButtonReturn),@"note":text}
            identifier:identifier action:action]; return;
    }
    if ([action isEqual:@"transcript"]) {
        NSURL *file = [self pickFile:@"导入已有带时间戳的 Transcript JSON" types:@[UTTypeJSON]];
        if (!file) { [self success:identifier data:@{@"cancelled":@YES}]; return; }
        [self send:@{@"type":@"transcript",@"asset_id":self.activeAsset,@"path":file.path} identifier:identifier action:action]; return;
    }
    if ([action isEqual:@"export"]) {
        NSDictionary *request = body[@"request"];
        if (![request isKindOfClass:NSDictionary.class] || ![NSJSONSerialization isValidJSONObject:request] ||
            [NSJSONSerialization dataWithJSONObject:request options:0 error:nil].length > 32768) {
            [self failure:identifier message:@"导出参数无效。 "]; return;
        }
        NSURL *folder = [self pickDirectory:@"选择导出保存目录" initial:self.workspace];
        if (!folder) { [self success:identifier data:@{@"cancelled":@YES}]; return; }
        [self send:@{@"type":@"export",@"asset_id":self.activeAsset,@"request":request,@"text_source":[body[@"text_source"] isEqual:@"ocr"] ? @"ocr" : @"speech",@"destination":folder.path}
            identifier:identifier action:action]; return;
    }
    [self failure:identifier message:@"不支持的操作。 "];
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    NSMenu *menu = [NSMenu new];
    NSMenuItem *item = [NSMenuItem new]; [menu addItem:item];
    NSMenu *appMenu = [NSMenu new];
    [appMenu addItemWithTitle:@"退出 LinkParsing" action:@selector(terminate:) keyEquivalent:@"q"];
    item.submenu = appMenu;
    NSMenuItem *editItem = [NSMenuItem new]; [menu addItem:editItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"编辑"];
    [editMenu addItemWithTitle:@"撤销" action:@selector(undo:) keyEquivalent:@"z"];
    [editMenu addItemWithTitle:@"剪切" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"复制" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"粘贴" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"全选" action:@selector(selectAll:) keyEquivalent:@"a"];
    editItem.submenu = editMenu;
    NSApp.mainMenu = menu;
    NSApp.applicationIconImage = [[NSImage alloc] initWithContentsOfURL:[NSBundle.mainBundle URLForResource:@"LinkParsing" withExtension:@"icns"]];
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1200,820)
        styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable
        backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"LinkParsing";
    self.window.minSize = NSMakeSize(860,640);
    self.window.releasedWhenClosed = NO;
    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
    configuration.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
    [configuration.userContentController addScriptMessageHandler:self name:@"desktop"];
    self.web = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:configuration];
    self.web.autoresizingMask = NSViewWidthSizable|NSViewHeightSizable;
    self.web.navigationDelegate = self;
    self.window.contentView = self.web;
    self.page = [NSBundle.mainBundle URLForResource:@"index" withExtension:@"html" subdirectory:@"Desktop"];
    NSString *savedWorkspace = [self preference:@"LPWorkspace"];
    BOOL isDirectory = NO;
    if (savedWorkspace && [NSFileManager.defaultManager fileExistsAtPath:savedWorkspace isDirectory:&isDirectory] && isDirectory)
        self.workspace = [NSURL fileURLWithPath:savedWorkspace];
    [self startWorker];
    [self.web loadFileURL:self.page allowingReadAccessToURL:self.page.URLByDeletingLastPathComponent];
    [self.window center]; [self.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
}
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
    (void)webView;
    handler([action.request.URL isEqual:self.page] ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
    (void)sender; if (!visible) [self.window makeKeyAndOrderFront:nil]; return YES;
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { (void)sender; return YES; }
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    (void)sender;
    [self.playerView.player pause];
    if (!self.worker.running) return NSTerminateNow;
    [self stopObservingPlayer];
    self.quitting = YES;
    // EOF cancels running tools and removes private snapshots before the backend exits.
    [self.input.fileHandleForWriting closeFile];
    return NSTerminateLater;
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc == 2 && strcmp(argv[1],"--self-check") == 0) {
            NSBundle *bundle = NSBundle.mainBundle;
            BOOL valid = [bundle URLForResource:@"index" withExtension:@"html" subdirectory:@"Desktop"] != nil
                && [bundle URLForResource:@"LinkParsing" withExtension:@"icns"] != nil
                && [NSFileManager.defaultManager isExecutableFileAtPath:[bundle.executablePath.stringByDeletingLastPathComponent stringByAppendingPathComponent:@"linkparsing-desktop"]];
            puts(valid ? "bundle resources: OK" : "bundle resources: missing"); return valid ? 0 : 1;
        }
        NSApplication *app = NSApplication.sharedApplication;
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        LPDelegate *delegate = [LPDelegate new]; app.delegate = delegate; [app run];
    }
    return LPTestExitStatus;
}
