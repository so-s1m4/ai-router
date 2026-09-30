import { App } from './app';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';

const file = (name:string) => ({name,size:10,modified:'2026-09-30T00:00:00Z'});
const group = (id:string,names:string[]) => ({kind:'projects' as const,id,title:id,runnerId:'runner',files:names.map(file)});

describe('File selection and bulk deletion',()=>{
  let app:App;
  let api:jasmine.Spy;
  let confirmation:jasmine.Spy;
  beforeEach(()=>{
    app=new App({} as DomSanitizer);
    api=spyOn(app,'api').and.resolveTo({ok:true});
    confirmation=spyOn(window,'confirm').and.returnValue(true);
  });

  it('selects filtered files and keeps equal names in different workspaces distinct',()=>{
    const first=group('first',['same.txt','other.pdf']),second=group('second',['same.txt']);
    app.fileGroups.set([first,second]);app.libraryQuery.set('.txt');
    app.selectAllFiles('library',true);
    expect(app.selectedLibraryFiles().size).toBe(2);
    expect(app.allLibraryFilesSelected()).toBeTrue();
    app.toggleFileSelection('library',app.librarySelectionKey(first,'same.txt'),false);
    expect(app.selectedLibraryFiles().has(app.librarySelectionKey(second,'same.txt'))).toBeTrue();
    expect(app.allLibraryFilesSelected()).toBeFalse();
    expect(app.someLibraryFilesSelected()).toBeTrue();
  });

  it('selects files in collapsed directories and respects the task filter',()=>{
    app.taskFiles.set(['nested/a.txt','nested/b.txt','other.pdf'].map(file));
    app.collapsedDirs.set(new Set(['nested']));app.filesFilter.set('.txt');
    app.selectAllFiles('task',true);
    expect([...app.selectedTaskFiles()]).toEqual(['nested/a.txt','nested/b.txt']);
    app.selectAllFiles('task',false);
    expect(app.selectedTaskFiles().size).toBe(0);
  });

  it('deletes across workspaces after a single confirmation, including hidden selections',async()=>{
    app.fileGroups.set([group('first',['a.txt']),group('second',['a.txt'])]);
    app.selectAllFiles('library',true);app.librarySource.set('projects:first');
    await app.deleteSelectedLibraryFiles();
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect(api.calls.allArgs().map(args=>args[0])).toEqual(['/workspaces/projects/first/files','/workspaces/projects/second/files']);
    expect(app.fileGroups().every(g=>!g.files.length)).toBeTrue();
    expect(app.selectedLibraryFiles().size).toBe(0);
    expect(app.deletingFile()).toBe('');
  });

  it('makes no requests when deletion is cancelled',async()=>{
    app.fileGroups.set([group('first',['a.txt'])]);app.selectAllFiles('library',true);
    confirmation.and.returnValue(false);
    await app.deleteSelectedLibraryFiles();
    expect(api).not.toHaveBeenCalled();expect(app.selectedLibraryFiles().size).toBe(1);
  });

  it('continues after a failure and retains only failed files for retry',async()=>{
    app.fileGroups.set([group('first',['a.txt','b.txt','c.txt'])]);app.selectAllFiles('library',true);
    api.and.callFake(async(_path:string,options:RequestInit)=>{
      if(JSON.parse(options.body as string).name==='b.txt')throw new Error('Runner unavailable');
      return {ok:true};
    });
    await app.deleteSelectedLibraryFiles();
    expect(api).toHaveBeenCalledTimes(3);
    expect(app.fileGroups()[0].files.map(f=>f.name)).toEqual(['b.txt']);
    expect(app.selectedLibraryFiles().size).toBe(1);
    expect(app.error()).toContain('b.txt: Runner unavailable');
    expect(app.notice()).toContain('2 из 3');
    expect(app.deletingFile()).toBe('');
  });

  it('locks selection and prevents overlapping batches while a delete is pending',async()=>{
    let finish!:(value:unknown)=>void;
    api.and.returnValue(new Promise(resolve=>{finish=resolve;}));
    app.fileGroups.set([group('first',['a.txt','b.txt'])]);
    app.toggleFileSelection('library',app.librarySelectionKey(app.fileGroups()[0],'a.txt'),true);
    const pending=app.deleteSelectedLibraryFiles();
    app.selectAllFiles('library',true);
    await app.deleteSelectedLibraryFiles();
    expect(app.selectedLibraryFiles().size).toBe(1);expect(api).toHaveBeenCalledTimes(1);
    finish({ok:true});await pending;
  });

  it('updates the task, library and shared links for a project file',async()=>{
    app.current.set({id:'chat',projectId:'project'} as NonNullable<ReturnType<App['current']>>);
    app.taskFiles.set(['a.txt','b.txt'].map(file));app.sharedFileLinks.set({'a.txt':'https://example.com/a'});
    app.fileGroups.set([group('project',['a.txt','b.txt'])]);
    app.toggleFileSelection('task','a.txt',true);
    await app.deleteSelectedTaskFiles();
    expect(app.taskFiles().map(f=>f.name)).toEqual(['b.txt']);
    expect(app.fileGroups()[0].files.map(f=>f.name)).toEqual(['b.txt']);
    expect(app.selectedTaskFiles().size).toBe(0);expect(app.sharedFileLinks()['a.txt']).toBeUndefined();
  });

  it('does not remove a same-named file when the user switches tasks during deletion',async()=>{
    app.current.set({id:'old'} as NonNullable<ReturnType<App['current']>>);
    app.taskFiles.set([file('a.txt')]);app.toggleFileSelection('task','a.txt',true);
    api.and.callFake(async()=>{
      app.current.set({id:'new'} as NonNullable<ReturnType<App['current']>>);
      app.taskFiles.set([file('a.txt')]);return {ok:true};
    });
    await app.deleteSelectedTaskFiles();
    expect(app.taskFiles().map(f=>f.name)).toEqual(['a.txt']);
  });

  it('removes stale selections after refreshing the library',async()=>{
    app.fileGroups.set([group('first',['a.txt','b.txt'])]);app.selectAllFiles('library',true);
    api.and.resolveTo({groups:[group('first',['b.txt'])]});
    await app.refreshLibrary();
    expect([...app.selectedLibraryFiles()]).toEqual([app.librarySelectionKey(app.fileGroups()[0],'b.txt')]);
  });
});


describe('File selection controls',()=>{
  it('renders selection and delete controls in the file library',async()=>{
    await TestBed.configureTestingModule({imports:[App]}).compileComponents();
    spyOn(App.prototype,'ngOnInit');spyOn(App.prototype,'ngAfterViewInit');
    const fixture=TestBed.createComponent(App),app=fixture.componentInstance;
    spyOn(app,'api').and.resolveTo({ok:true});spyOn(window,'confirm').and.returnValue(true);
    app.loggedIn.set(true);app.page.set('files');app.fileGroups.set([group('project',['a.txt','b.txt'])]);
    fixture.detectChanges();
    const root=fixture.nativeElement as HTMLElement;
    const selectAll=root.querySelector<HTMLInputElement>('.file-library .file-select-all input')!;
    const deleteButton=root.querySelector<HTMLButtonElement>('.file-library .file-selection-toolbar .btn-danger-outline')!;
    expect(selectAll).toBeTruthy();expect(deleteButton.disabled).toBeTrue();
    selectAll.click();fixture.detectChanges();
    expect(root.querySelectorAll('.library-file .file-select-checkbox:checked').length).toBe(2);
    expect(deleteButton.disabled).toBeFalse();expect(deleteButton.textContent).toContain('(2)');
    deleteButton.click();await fixture.whenStable();fixture.detectChanges();
    expect(root.querySelectorAll('.library-file').length).toBe(0);
    fixture.destroy();
  });

  it('renders task checkboxes and a working select-all action',async()=>{
    await TestBed.configureTestingModule({imports:[App]}).compileComponents();
    spyOn(App.prototype,'ngOnInit');spyOn(App.prototype,'ngAfterViewInit');
    const fixture=TestBed.createComponent(App),app=fixture.componentInstance;
    app.loggedIn.set(true);app.page.set('chat');app.filesOpen.set(true);
    app.current.set({id:'chat',title:'Test',messages:[],updatedAt:'2026-09-30T00:00:00Z'} as NonNullable<ReturnType<App['current']>>);
    app.taskFiles.set(['a.txt','b.txt'].map(file));fixture.detectChanges();
    const root=fixture.nativeElement as HTMLElement;
    const selectAll=root.querySelector<HTMLInputElement>('.task-files-panel .file-select-all input')!;
    expect(selectAll).toBeTruthy();selectAll.click();fixture.detectChanges();
    expect(root.querySelectorAll('.task-tree-file .file-select-checkbox:checked').length).toBe(2);
    fixture.destroy();
  });
});
