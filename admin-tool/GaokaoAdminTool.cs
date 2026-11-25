using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace GaokaoAdminTool
{
    static class Core
    {
        public static readonly string UserDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GaokaoCountdown");
        public static readonly string TicketFile = Path.Combine(UserDir, "admin-unlock.json");
        public static readonly string QuotaFile = Path.Combine(UserDir, "admin-quota.json");
        public static readonly string StoreFile = Path.Combine(UserDir, "store.json");

        public static long NowMs()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        public static string Today()
        {
            return DateTime.Now.ToString("yyyy-MM-dd");
        }

        public static long TicketExpires()
        {
            try
            {
                if (!File.Exists(TicketFile)) return 0;
                string text = File.ReadAllText(TicketFile, Encoding.UTF8);
                Match m = Regex.Match(text, "\"expires\"\\s*:\\s*(\\d+)");
                if (!m.Success) return 0;
                long v;
                if (!long.TryParse(m.Groups[1].Value, out v)) return 0;
                return v;
            }
            catch { return 0; }
        }

        public static long TicketRemain()
        {
            long exp = TicketExpires();
            long now = NowMs();
            return exp > now ? exp - now : 0;
        }

        public static long WriteTicket(int minutes)
        {
            if (minutes < 1) minutes = 1;
            if (minutes > 10080) minutes = 10080;
            Directory.CreateDirectory(UserDir);
            long exp = NowMs() + minutes * 60000L;
            string json = "{\"expires\":" + exp.ToString(CultureInfo.InvariantCulture) +
                ",\"minutes\":" + minutes.ToString(CultureInfo.InvariantCulture) +
                ",\"by\":\"GaokaoAdminTool\"}";
            File.WriteAllText(TicketFile, json, new UTF8Encoding(false));
            return exp;
        }

        public static bool DropTicket()
        {
            try
            {
                if (File.Exists(TicketFile)) File.Delete(TicketFile);
                return true;
            }
            catch { return false; }
        }

        public static string QuotaName()
        {
            try
            {
                if (!File.Exists(QuotaFile)) return "";
                string text = File.ReadAllText(QuotaFile, Encoding.UTF8);
                Match d = Regex.Match(text, "\"date\"\\s*:\\s*\"([^\"]*)\"");
                if (!d.Success || d.Groups[1].Value != Today()) return "";
                Match n = Regex.Match(text, "\"name\"\\s*:\\s*\"([^\"]*)\"");
                return n.Success ? n.Groups[1].Value : "（未记录姓名）";
            }
            catch { return ""; }
        }

        public static string QuotaSummary()
        {
            string name = QuotaName();
            if (name.Length == 0) return "今日权重额度：未使用";
            return "今日权重额度：已用于「" + name + "」，其他学生权重今日锁定";
        }

        public static string Hex(byte[] data)
        {
            StringBuilder sb = new StringBuilder(data.Length * 2);
            for (int i = 0; i < data.Length; i++) sb.Append(data[i].ToString("x2"));
            return sb.ToString();
        }

        public static string Sha256Hex(string text)
        {
            using (SHA256 sha = SHA256.Create())
            {
                byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(text));
                return Hex(bytes);
            }
        }

        public static string SetPassword(string pw)
        {
            if (pw == null || pw.Length < 4) return "密码至少 4 位";
            if (!File.Exists(StoreFile)) return "没找到 store.json，请先启动一次主程序";
            try
            {
                byte[] saltBytes = new byte[16];
                using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) { rng.GetBytes(saltBytes); }
                string salt = Hex(saltBytes);
                string hash = Sha256Hex(salt + "|" + pw);
                string text = File.ReadAllText(StoreFile, Encoding.UTF8);
                if (Regex.IsMatch(text, "\"passwordSalt\""))
                {
                    text = Regex.Replace(text, "\"passwordSalt\"\\s*:\\s*\"[^\"]*\"", "\"passwordSalt\":\"" + salt + "\"");
                    text = Regex.Replace(text, "\"passwordHash\"\\s*:\\s*\"[^\"]*\"", "\"passwordHash\":\"" + hash + "\"");
                }
                else
                {
                    Match m = Regex.Match(text, "\"classroom\"\\s*:\\s*\\{");
                    if (!m.Success) return "store.json 结构不认识，没有 classroom 段";
                    text = text.Insert(m.Index + m.Length,
                        "\"passwordSalt\":\"" + salt + "\",\"passwordHash\":\"" + hash + "\",");
                }
                File.WriteAllText(StoreFile, text, new UTF8Encoding(false));
                return "密码已更新，请重启主程序后生效";
            }
            catch (Exception ex)
            {
                return "改密码失败：" + ex.Message;
            }
        }

        public static string FindApp()
        {
            string env = Environment.GetEnvironmentVariable("GK_APP_EXE");
            if (!string.IsNullOrEmpty(env) && File.Exists(env)) return env;
            string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string parent = baseDir;
            DirectoryInfo di = Directory.GetParent(baseDir);
            if (di != null) parent = di.FullName;
            string[] direct = new string[] {
                Path.Combine(baseDir, "高考倒计时.exe"),
                Path.Combine(parent, "高考倒计时.exe")
            };
            for (int i = 0; i < direct.Length; i++) if (File.Exists(direct[i])) return direct[i];
            try
            {
                string[] dirs = Directory.GetDirectories(parent, "dist*");
                Array.Sort(dirs, delegate(string x, string y)
                {
                    return Directory.GetLastWriteTimeUtc(y).CompareTo(Directory.GetLastWriteTimeUtc(x));
                });
                for (int i = 0; i < dirs.Length; i++)
                {
                    string exe = Path.Combine(dirs[i], "win-unpacked", "高考倒计时.exe");
                    if (File.Exists(exe)) return exe;
                }
            }
            catch { }
            string local = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "高考倒计时", "高考倒计时.exe");
            if (File.Exists(local)) return local;
            return "";
        }

        public static string OpenAdminMode(int minutes)
        {
            WriteTicket(minutes);
            string app = FindApp();
            if (app.Length == 0)
                return "已写入 " + minutes + " 分钟票据，但没找到主程序。请手动打开高考倒计时，再从「课堂助手 → 管理员模式」进入。";
            try
            {
                Process.Start(new ProcessStartInfo(app, "--admin") { UseShellExecute = true });
                return "已写入 " + minutes + " 分钟票据，正在打开主程序的管理员模式…";
            }
            catch (Exception ex)
            {
                return "票据已写入，启动主程序失败：" + ex.Message;
            }
        }
    }

    public class MainForm : Form
    {
        private Label lblState;
        private Label lblQuota;
        private Label lblTicketPath;
        private NumericUpDown numMinutes;
        private TextBox txtPw1;
        private TextBox txtPw2;
        private TextBox txtLog;
        private Timer timer;
        private bool autoLaunched;

        public MainForm()
        {
            Text = "管理员免密 · 高考倒计时";
            ClientSize = new Size(660, 700);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Color.FromArgb(244, 241, 234);
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            BuildUi();
            RefreshState();
            timer = new Timer();
            timer.Interval = 2000;
            timer.Tick += delegate { RefreshState(); };
            timer.Start();
            Shown += delegate
            {
                if (autoLaunched) return;
                autoLaunched = true;
                BeginInvoke((MethodInvoker)delegate { DoOpenAdmin(1, "启动自动打开"); });
            };
        }

        private Color Ink { get { return Color.FromArgb(59, 58, 54); } }
        private Color Dim { get { return Color.FromArgb(120, 114, 102); } }

        private GroupBox Group(string title, int x, int y, int w, int h)
        {
            GroupBox g = new GroupBox();
            g.Text = title;
            g.SetBounds(x, y, w, h);
            g.ForeColor = Dim;
            g.BackColor = Color.FromArgb(252, 250, 245);
            Controls.Add(g);
            return g;
        }

        private Button Btn(Control parent, string text, int x, int y, int w, int h, bool primary)
        {
            Button b = new Button();
            b.Text = text;
            b.SetBounds(x, y, w, h);
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderSize = 1;
            b.Cursor = Cursors.Hand;
            if (primary)
            {
                b.BackColor = Color.FromArgb(169, 124, 42);
                b.ForeColor = Color.White;
                b.FlatAppearance.BorderColor = Color.FromArgb(169, 124, 42);
            }
            else
            {
                b.BackColor = Color.FromArgb(250, 248, 242);
                b.ForeColor = Ink;
                b.FlatAppearance.BorderColor = Color.FromArgb(206, 198, 182);
            }
            parent.Controls.Add(b);
            return b;
        }

        private Label Lbl(Control parent, string text, int x, int y, int w, int h, float size, bool bold)
        {
            Label l = new Label();
            l.Text = text;
            l.SetBounds(x, y, w, h);
            l.AutoSize = false;
            l.Font = new Font("Microsoft YaHei UI", size, bold ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Point);
            l.ForeColor = Ink;
            parent.Controls.Add(l);
            return l;
        }

        private void BuildUi()
        {
            Label title = Lbl(this, "管理员免密", 24, 16, 320, 34, 15F, true);
            title.ForeColor = Ink;
            Label sub = Lbl(this, "启动即写入 1 分钟票据，并自动打开主程序的管理员模式；一天只放一名学生的权重。", 24, 50, 610, 24, 9F, false);
            sub.ForeColor = Dim;

            GroupBox g1 = Group("当前状态", 20, 84, 620, 120);
            lblState = Lbl(g1, "未开启免密", 16, 26, 460, 26, 12F, true);
            lblQuota = Lbl(g1, "今日权重额度：未使用", 16, 56, 470, 22, 9F, false);
            lblQuota.ForeColor = Dim;
            lblTicketPath = Lbl(g1, "票据文件：", 16, 82, 470, 22, 8F, false);
            lblTicketPath.ForeColor = Dim;
            lblTicketPath.AutoEllipsis = true;
            Btn(g1, "刷新", 500, 22, 104, 32, false).Click += delegate { RefreshState(); };

            GroupBox g2 = Group("开启免密并打开管理员模式", 20, 214, 620, 150);
            Button b1 = Btn(g2, "1 分钟", 16, 30, 70, 32, false);
            Button b5 = Btn(g2, "5 分钟", 94, 30, 70, 32, false);
            Button b30 = Btn(g2, "30 分钟", 172, 30, 80, 32, false);
            Label cl = Lbl(g2, "自定义", 268, 36, 60, 22, 9F, false);
            cl.ForeColor = Dim;
            numMinutes = new NumericUpDown();
            numMinutes.SetBounds(330, 32, 62, 28);
            numMinutes.Minimum = 1;
            numMinutes.Maximum = 10080;
            numMinutes.Value = 1;
            g2.Controls.Add(numMinutes);
            Label ml = Lbl(g2, "分钟", 398, 36, 44, 22, 9F, false);
            ml.ForeColor = Dim;
            Button bCustom = Btn(g2, "按自定义时长打开", 440, 30, 164, 32, false);
            Button bOpen = Btn(g2, "开启并打开管理员模式", 16, 80, 236, 34, true);
            Label tip = Lbl(g2, "主程序已在运行时同样会直接跳到管理员模式。", 16, 120, 580, 22, 8.5F, false);
            tip.ForeColor = Dim;

            b1.Click += delegate { DoOpenAdmin(1, "1 分钟"); };
            b5.Click += delegate { DoOpenAdmin(5, "5 分钟"); };
            b30.Click += delegate { DoOpenAdmin(30, "30 分钟"); };
            bCustom.Click += delegate { DoOpenAdmin((int)numMinutes.Value, (int)numMinutes.Value + " 分钟"); };
            bOpen.Click += delegate { DoOpenAdmin(1, "手动"); };

            GroupBox g3 = Group("立即收回", 20, 376, 620, 96);
            Button bLock = Btn(g3, "收回免密", 16, 32, 120, 32, false);
            Label l3 = Lbl(g3, "收回后重新进入管理员需要密码。", 152, 36, 450, 44, 8.5F, false);
            l3.ForeColor = Dim;

            bLock.Click += delegate
            {
                bool ok = Core.DropTicket();
                Log(ok ? "已收回免密票据。" : "收回失败，请检查票据文件是否被占用。");
                RefreshState();
            };
            GroupBox g4 = Group("改管理员密码", 20, 484, 620, 110);
            txtPw1 = new TextBox();
            txtPw1.SetBounds(16, 32, 170, 28);
            txtPw1.UseSystemPasswordChar = true;
            txtPw1.PasswordChar = '*';
            g4.Controls.Add(txtPw1);
            txtPw2 = new TextBox();
            txtPw2.SetBounds(196, 32, 170, 28);
            txtPw2.UseSystemPasswordChar = true;
            txtPw2.PasswordChar = '*';
            g4.Controls.Add(txtPw2);
            Button bPw = Btn(g4, "修改密码", 376, 30, 120, 32, false);
            Label l4 = Lbl(g4, "不需要旧密码，两次输入一致即可；改完请重启主程序。", 16, 74, 560, 22, 8.5F, false);
            l4.ForeColor = Dim;
            bPw.Click += delegate
            {
                string a = txtPw1.Text;
                string b = txtPw2.Text;
                if (a.Length < 4) { Log("密码至少 4 位。"); return; }
                if (a != b) { Log("两次输入的密码不一致。"); return; }
                Log(Core.SetPassword(a));
                txtPw1.Text = "";
                txtPw2.Text = "";
            };

            txtLog = new TextBox();
            txtLog.SetBounds(20, 604, 620, 80);
            txtLog.Multiline = true;
            txtLog.ReadOnly = true;
            txtLog.ScrollBars = ScrollBars.Vertical;
            txtLog.BackColor = Color.FromArgb(252, 250, 245);
            txtLog.ForeColor = Dim;
            txtLog.Font = new Font("Microsoft YaHei UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            Controls.Add(txtLog);
        }

        private void RefreshState()
        {
            long remain = Core.TicketRemain();
            if (remain > 0)
            {
                lblState.Text = "免密已开启 · 剩余 " + ((remain + 999) / 1000) + " 秒";
                lblState.ForeColor = Color.FromArgb(52, 122, 72);
            }
            else
            {
                lblState.Text = "未开启免密";
                lblState.ForeColor = Color.FromArgb(150, 78, 62);
            }
            lblQuota.Text = Core.QuotaSummary();
            lblTicketPath.Text = "票据文件：" + Core.TicketFile;
        }

        private void Log(string message)
        {
            txtLog.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + message + Environment.NewLine);
        }

        private void DoOpenAdmin(int minutes, string label)
        {
            Log(Core.OpenAdminMode(minutes));
            RefreshState();
        }
    }

    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            string mode = "";
            int minutes = 1;
            string outFile = "";
            string pw = "";
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i].ToLowerInvariant();
                if (a == "--minutes" && i + 1 < args.Length)
                {
                    int mv;
                    if (int.TryParse(args[i + 1], out mv)) minutes = mv;
                    i++;
                    mode = "ticket";
                }
                else if (a == "--lock") mode = "lock";
                else if (a == "--status") mode = "status";
                else if (a == "--open") mode = (mode == "" ? "open" : mode + "+open");
                else if (a == "--out" && i + 1 < args.Length) { outFile = args[i + 1]; i++; }
                else if (a == "--set-password" && i + 1 < args.Length) { pw = args[i + 1]; i++; mode = "password"; }
            }

            if (mode.Length > 0)
            {
                StringBuilder sb = new StringBuilder();
                bool open = mode.IndexOf("+open") >= 0;
                if (mode.StartsWith("ticket") || mode.StartsWith("open"))
                {
                    long exp = Core.WriteTicket(minutes);
                    sb.AppendLine("action=ticket");
                    sb.AppendLine("expires=" + exp);
                }
                if (mode == "lock")
                {
                    sb.AppendLine("action=lock");
                    sb.AppendLine("ok=" + (Core.DropTicket() ? "1" : "0"));
                }
                if (mode == "password")
                {
                    sb.AppendLine("action=password");
                    sb.AppendLine("result=" + Core.SetPassword(pw));
                }
                sb.AppendLine("ticket_remain=" + Core.TicketRemain());
                sb.AppendLine("quota_name=" + Core.QuotaName());
                sb.AppendLine("app=" + Core.FindApp());
                if (open)
                {
                    sb.AppendLine("launch=" + Core.OpenAdminMode(minutes));
                }
                string text = sb.ToString();
                if (outFile.Length > 0)
                {
                    try { File.WriteAllText(outFile, text, new UTF8Encoding(false)); }
                    catch { }
                }
                try { Console.Out.Write(text); } catch { }
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }
}
