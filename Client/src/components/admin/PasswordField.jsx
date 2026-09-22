import React, { useState } from "react";
import { FaEye, FaEyeSlash } from "react-icons/fa";

const PasswordField = ({ label, placeholder = "", value = "", onChange, width = "100%" }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", position: "relative", width }}>
      <label style={{ fontSize: "14px", fontWeight: "500", color: "#4D4D4D" }}>{label}</label>
      <div style={{ position: "relative" }}>
        <input
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          style={{
            width: "100%",
            boxSizing: "border-box",
            height: "36px",
            borderRadius: "8px",
            border: "1px solid #E4E4E4",
            outline: "none",
            padding: "0 36px 0 10px",
            fontSize: "14px",
            color: "#383838",
            background: "#EFEFEF",
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          title={visible ? "Hide password" : "Show password"}
          style={{
            position: "absolute",
            right: "10px",
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            color: "#A1A1A1",
            display: "flex",
            alignItems: "center",
          }}
        >
          {visible ? <FaEyeSlash size={14} /> : <FaEye size={14} />}
        </button>
      </div>
    </div>
  );
};

export default PasswordField;
