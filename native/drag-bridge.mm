#import <AppKit/AppKit.h>
#import <node_api.h>
#include <vector>

static napi_threadsafe_function eventFunction;
static NSMutableDictionary<NSString *, id> *completions;
static NSMutableSet *owners;
static NSString *const TidePasteboardType = @"dev.tide.sftp.files";

static void Emit(NSDictionary *event) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
    if (eventFunction && json) {
        char *text = strdup([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
        if (napi_call_threadsafe_function(eventFunction, text, napi_tsfn_nonblocking) != napi_ok) free(text);
    }
}
static void Deliver(napi_env env, napi_value callback, void *context, void *data) {
    char *text = (char *)data;
    if (env) {
        napi_value value, global, result;
        napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &value);
        napi_get_global(env, &global);
        napi_call_function(env, global, callback, 1, &value, &result);
    }
    free(text);
}
static NSString *String(napi_env env, napi_value value) {
    size_t length = 0;
    napi_get_value_string_utf8(env, value, nullptr, 0, &length);
    std::vector<char> bytes(length + 1);
    napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &length);
    return [NSString stringWithUTF8String:bytes.data()];
}
static NSView *View(napi_env env, napi_value value) {
    void *data; size_t length;
    if (napi_get_buffer_info(env, value, &data, &length) != napi_ok || length != sizeof(void *)) return nil;
    return (__bridge NSView *)*(void **)data;
}

@interface TidePromiseProvider : NSFilePromiseProvider
@property NSString *payload;
@end
@implementation TidePromiseProvider
- (NSArray<NSPasteboardType> *)writableTypesForPasteboard:(NSPasteboard *)pasteboard {
    return [[super writableTypesForPasteboard:pasteboard] arrayByAddingObject:TidePasteboardType];
}
- (id)pasteboardPropertyListForType:(NSPasteboardType)type {
    if ([type isEqualToString:TidePasteboardType]) return self.payload;
    return [super pasteboardPropertyListForType:type];
}
@end

@interface TideDragOwner : NSObject <NSDraggingSource, NSFilePromiseProviderDelegate>
@property NSDictionary *payload;
@end
@implementation TideDragOwner
- (NSDragOperation)draggingSession:(NSDraggingSession *)session sourceOperationMaskForDraggingContext:(NSDraggingContext)context { return NSDragOperationCopy; }
- (BOOL)ignoreModifierKeysForDraggingSession:(NSDraggingSession *)session { return YES; }
- (NSString *)filePromiseProvider:(NSFilePromiseProvider *)provider fileNameForType:(NSString *)fileType { return provider.userInfo[@"name"]; }
- (void)filePromiseProvider:(NSFilePromiseProvider *)provider writePromiseToURL:(NSURL *)url completionHandler:(void (^)(NSError *))handler {
    NSString *identifier = NSUUID.UUID.UUIDString;
    completions[identifier] = [handler copy];
    Emit(@{@"phase": @"promise", @"id":identifier, @"destination":url.path, @"source":provider.userInfo[@"path"], @"kind":self.payload[@"kind"], @"sessionId":self.payload[@"sessionId"] ?: @""});
}
- (void)draggingSession:(NSDraggingSession *)session endedAtPoint:(NSPoint)point operation:(NSDragOperation)operation {
    Emit(@{@"phase":@"end"});
    // Providers retain their delegate in userInfo while promised writes remain outstanding
    [owners removeObject:self];
}
@end

@interface TideDropView : NSView <NSDraggingDestination>
@property NSArray *panes;
@end
@implementation TideDropView
- (NSView *)hitTest:(NSPoint)point { return NSApp.currentEvent.type==NSEventTypeLeftMouseDragged ? [super hitTest:point] : nil; }
- (BOOL)isFlipped { return YES; }
- (NSDictionary *)payload:(id<NSDraggingInfo>)sender {
    NSPasteboard *pasteboard = sender.draggingPasteboard;
    NSString *internal = [pasteboard stringForType:TidePasteboardType];
    if (internal) return [NSJSONSerialization JSONObjectWithData:[internal dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSArray<NSURL *> *files = [pasteboard readObjectsForClasses:@[NSURL.class] options:@{NSPasteboardURLReadingFileURLsOnlyKey:@YES}];
    if (!files.count) return nil;
    return @{@"kind":@"local", @"sources":[files valueForKey:@"path"]};
}
- (NSInteger)target:(id<NSDraggingInfo>)sender {
    NSPoint point=[self convertPoint:sender.draggingLocation fromView:nil];
    if (point.y < 48) return -1;
    NSInteger index=point.x < NSWidth(self.bounds)/2 ? 0 : 1;
    if (index>=self.panes.count || [self.panes[index] isEqual:NSNull.null] || ![self.panes[index][@"kind"] length]) return -1;
    NSDictionary *source=[self payload:sender], *target=self.panes[index];
    if (!source) return -1;
    if ([source[@"kind"] isEqual:target[@"kind"]] && [source[@"path"] isEqual:target[@"path"]] && [(source[@"sessionId"] ?: @"") isEqual:(target[@"sessionId"] ?: @"")]) return -1;
    if ([source[@"kind"] isEqual:@"local"] && [target[@"kind"] isEqual:@"local"]) {
        BOOL same = YES;
        for (NSString *file in source[@"sources"]) if (![[file.stringByDeletingLastPathComponent stringByResolvingSymlinksInPath] isEqual:[target[@"path"] stringByResolvingSymlinksInPath]]) same=NO;
        if (same) return -1;
    }
    return index;
}
- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)sender { return [self draggingUpdated:sender]; }
- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)sender {
    NSInteger index=[self target:sender];
    Emit(@{@"phase":@"hover", @"index":@(index)});
    return index<0?NSDragOperationNone:NSDragOperationCopy;
}
- (void)draggingExited:(id<NSDraggingInfo>)sender { Emit(@{@"phase":@"hover", @"index":@(-1)}); }
- (BOOL)prepareForDragOperation:(id<NSDraggingInfo>)sender { return [self target:sender]>=0; }
- (BOOL)performDragOperation:(id<NSDraggingInfo>)sender {
    NSInteger index=[self target:sender];
    if (index<0) return NO;
    Emit(@{@"phase":@"drop", @"index":@(index), @"payload":[self payload:sender]});
    return YES;
}
@end
static TideDropView *dropView;

static napi_value Install(napi_env env, napi_callback_info info) {
    size_t count=2; napi_value args[2]; napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    NSView *view=View(env,args[0]);
    napi_value name; napi_create_string_utf8(env,"Tide native drag events",NAPI_AUTO_LENGTH,&name);
    napi_create_threadsafe_function(env,args[1],nullptr,name,0,1,nullptr,nullptr,nullptr,Deliver,&eventFunction);
    napi_unref_threadsafe_function(env,eventFunction);
    completions=[NSMutableDictionary new];owners=[NSMutableSet new];
    dropView=[[TideDropView alloc] initWithFrame:view.bounds];
    dropView.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
    [dropView registerForDraggedTypes:@[TidePasteboardType,NSPasteboardTypeFileURL]];
    [view addSubview:dropView positioned:NSWindowAbove relativeTo:nil];
    napi_value result; napi_get_undefined(env,&result); return result;
}
static napi_value Update(napi_env env,napi_callback_info info) {
    size_t count=1;napi_value arg;napi_get_cb_info(env,info,&count,&arg,nullptr,nullptr);
    dropView.panes=[NSJSONSerialization JSONObjectWithData:[String(env,arg) dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    napi_value result;napi_get_undefined(env,&result);return result;
}
static napi_value Begin(napi_env env,napi_callback_info info) {
    size_t count=4;napi_value args[4];napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    NSView *view=View(env,args[0]);NSString *json=String(env,args[1]);NSDictionary *payload=[NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    void *bytes;size_t length;napi_get_buffer_info(env,args[2],&bytes,&length);
    NSImage *image=[[NSImage alloc] initWithData:[NSData dataWithBytes:bytes length:length]];
    NSDictionary *position=[NSJSONSerialization JSONObjectWithData:[String(env,args[3]) dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSPoint point=NSMakePoint([position[@"x"] doubleValue],NSHeight(view.bounds)-[position[@"y"] doubleValue]);
    NSEvent *event=[NSEvent mouseEventWithType:NSEventTypeLeftMouseDragged location:point modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:view.window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];
    TideDragOwner *owner=[TideDragOwner new];owner.payload=payload;[owners addObject:owner];
    NSMutableArray *items=[NSMutableArray new];NSArray *sources=payload[@"sources"],*entries=payload[@"entries"];
    for (NSUInteger index=0;index<sources.count;index++) {
        NSString *source=sources[index];NSDictionary *entry=index<entries.count?entries[index]:@{};
        id<NSPasteboardWriting> writer;
        if ([payload[@"kind"] isEqual:@"local"]) {
            NSPasteboardItem *item=[NSPasteboardItem new];[item setString:[NSURL fileURLWithPath:source].absoluteString forType:NSPasteboardTypeFileURL];[item setString:json forType:TidePasteboardType];writer=item;
        } else {
            TidePromiseProvider *provider=[[TidePromiseProvider alloc] initWithFileType:[entry[@"directory"] boolValue]?@"public.directory":@"public.data" delegate:owner];
            provider.userInfo=@{@"name":source.lastPathComponent,@"path":source,@"owner":owner};provider.payload=json;writer=provider;
        }
        NSDraggingItem *item=[[NSDraggingItem alloc] initWithPasteboardWriter:writer];
        NSSize size=NSMakeSize([payload[@"previewWidth"] doubleValue] ?: image.size.width,[payload[@"previewHeight"] doubleValue] ?: image.size.height);
        [item setDraggingFrame:NSMakeRect(point.x-30,point.y-20,size.width,size.height) contents:index==0?image:[[NSImage alloc] initWithSize:NSMakeSize(1,1)]];
        [items addObject:item];
    }
    @try {NSDraggingSession *session=[view beginDraggingSessionWithItems:items event:event source:owner];session.animatesToStartingPositionsOnCancelOrFail=YES;session.draggingFormation=NSDraggingFormationNone;}
    @catch(NSException *exception){napi_throw_error(env,nullptr,exception.reason.UTF8String);}
    napi_value result;napi_get_undefined(env,&result);return result;
}
static napi_value Complete(napi_env env,napi_callback_info info) {
    size_t count=2;napi_value args[2];napi_get_cb_info(env,info,&count,args,nullptr,nullptr);NSString *identifier=String(env,args[0]),*message=String(env,args[1]);
    void (^completion)(NSError *)=completions[identifier];if(completion){[completions removeObjectForKey:identifier];completion(message.length?[NSError errorWithDomain:@"dev.tide.sftp" code:1 userInfo:@{NSLocalizedDescriptionKey:message}]:nil);}
    napi_value result;napi_get_undefined(env,&result);return result;
}
static napi_value VerifyPromise(napi_env env,napi_callback_info info) {
    size_t count=2;napi_value args[2];napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    NSString *json=String(env,args[0]),*destination=String(env,args[1]);
    NSDictionary *payload=[NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    TideDragOwner *owner=[TideDragOwner new];owner.payload=payload;
    TidePromiseProvider *provider=[[TidePromiseProvider alloc] initWithFileType:@"public.data" delegate:owner];
    NSString *source=[payload[@"sources"] firstObject];provider.userInfo=@{@"name":source.lastPathComponent,@"path":source,@"owner":owner};provider.payload=json;
    [owner filePromiseProvider:provider writePromiseToURL:[NSURL fileURLWithPath:[destination stringByAppendingPathComponent:source.lastPathComponent]] completionHandler:^(NSError *error){Emit(@{@"phase":@"verified-promise",@"error":error.localizedDescription ?: @""});}];
    napi_value result;napi_create_uint32(env,1,&result);return result;
}

static napi_value Init(napi_env env,napi_value exports) {
    napi_property_descriptor methods[]={{"verifyPromise",0,VerifyPromise,0,0,0,napi_default,0},{"install",0,Install,0,0,0,napi_default,0},{"update",0,Update,0,0,0,napi_default,0},{"begin",0,Begin,0,0,0,napi_default,0},{"complete",0,Complete,0,0,0,napi_default,0}};
    napi_define_properties(env,exports,5,methods);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,Init)
