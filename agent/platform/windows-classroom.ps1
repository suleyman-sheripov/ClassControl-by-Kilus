# A single helper owns the keyboard hook and taskbar visibility. EOF restores the desktop.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public static class ClassroomDesktop {
  delegate IntPtr HookProc(int n, IntPtr w, IntPtr l);
  delegate bool EnumProc(IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct Key { public uint vk, scan, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct Msg { public IntPtr hwnd; public uint message; public UIntPtr w; public IntPtr l; public uint time; public int x,y; public uint privateData; }
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc cb, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h,int n,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr w,System.Text.StringBuilder b,int max);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr w,int cmd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr w);
  [DllImport("user32.dll")] static extern int GetMessage(out Msg m,IntPtr w,uint min,uint max);
  [DllImport("user32.dll")] static extern bool PeekMessage(out Msg m,IntPtr w,uint min,uint max,uint flags);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref Msg m);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Msg m);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread,uint message,UIntPtr w,IntPtr l);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
  static HookProc callback = Filter;
  static IntPtr hook;
  static volatile bool locked;
  static HashSet<IntPtr> hidden = new HashSet<IntPtr>();
  static IntPtr Filter(int n,IntPtr w,IntPtr l) {
    if(n>=0 && locked) {
      Key k=(Key)Marshal.PtrToStructure(l,typeof(Key));
      bool alt=(k.flags&32)!=0, ctrl=(GetAsyncKeyState(0x11)&0x8000)!=0;
      if((k.flags&16)==0 && (k.vk==0x5B || k.vk==0x5C || (alt&&(k.vk==9||k.vk==27||k.vk==0x73)) || (ctrl&&k.vk==27))) return new IntPtr(1);
    }
    return CallNextHookEx(hook,n,w,l);
  }
  static void Tasks(bool hide) {
    if(!hide) { foreach(IntPtr w in hidden) ShowWindow(w,5); hidden.Clear(); return; }
    EnumWindows((w,l)=> { var b=new System.Text.StringBuilder(256);GetClassName(w,b,b.Capacity);
      if((b.ToString()=="Shell_TrayWnd"||b.ToString()=="Shell_SecondaryTrayWnd")&&IsWindowVisible(w)) { hidden.Add(w);ShowWindow(w,0); } return true; },IntPtr.Zero);
  }
  public static void Run() {
    uint tid=GetCurrentThreadId(); Msg m; PeekMessage(out m,IntPtr.Zero,0,0,0);
    hook=SetWindowsHookEx(13,callback,GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName),0);
    if(hook==IntPtr.Zero) throw new InvalidOperationException("Cannot install keyboard hook: "+Marshal.GetLastWin32Error());
    string desired="off"; object gate=new object();
    var input=new Thread(()=> { string line;while((line=Console.ReadLine())!=null) { lock(gate)desired=line;PostThreadMessage(tid,0x8001,UIntPtr.Zero,IntPtr.Zero); }PostThreadMessage(tid,0x12,UIntPtr.Zero,IntPtr.Zero); });input.IsBackground=true;input.Start();
    Console.WriteLine("READY");Console.Out.Flush();
    try { while(GetMessage(out m,IntPtr.Zero,0,0)>0) {
      if(m.message==0x8001) { string mode;lock(gate)mode=desired;locked=mode=="lock";Tasks(mode=="lock"||mode=="presentation"); }
      else { TranslateMessage(ref m);DispatchMessage(ref m); }
    }} finally { locked=false;UnhookWindowsHookEx(hook);Tasks(false); }
  }
}
'@
[ClassroomDesktop]::Run()
