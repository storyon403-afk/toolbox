// Private local helper: one image in, bounded JSON on stdout; no media diagnostics.
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 3) return 2;
        NSString *language = [NSString stringWithUTF8String:argv[2]];
        NSDictionary *languages = @{@"zh":@[@"zh-Hans",@"en-US"], @"en":@[@"en-US"],
                                     @"ja":@[@"ja-JP",@"en-US"], @"ko":@[@"ko-KR",@"en-US"]};
        if (!languages[language]) return 2;
        VNRecognizeTextRequest *request = [VNRecognizeTextRequest new];
        request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        request.recognitionLanguages = languages[language];
        request.usesLanguageCorrection = YES;
        NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
        VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithURL:url options:@{}];
        if (![handler performRequests:@[request] error:nil]) return 3;
        NSMutableArray *lines = [NSMutableArray new];
        NSUInteger bytes = 0;
        for (VNRecognizedTextObservation *observation in request.results) {
            NSString *text = [observation topCandidates:1].firstObject.string;
            if (!text.length) continue;
            bytes += [text lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
            if (bytes > 65536 || lines.count >= 1000) return 4;
            [lines addObject:text];
        }
        NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"text":[lines componentsJoinedByString:@"\n"]} options:0 error:nil];
        if (!data) return 3;
        [[NSFileHandle fileHandleWithStandardOutput] writeData:data];
    }
    return 0;
}
